# FEAT-001 — Fundação

**Status:** em desenvolvimento · **Issue:** FEAT-001 · **Branch:** `feature/FEAT-001-fundacao` · **Data:** 2026-08-25

## Contexto e objetivo

Este é o primeiro código do projeto. Antes dele não existe `package.json`, não existe kernel, não existe nada — só a documentação. A fundação entrega a espinha dorsal sobre a qual todo módulo futuro (tasks, capture, chains, rituals...) vai se plugar, e prova isso com uma fatia mínima real ponta a ponta: mensagem "ping" no WhatsApp → resposta "pong", sem LLM no caminho.

Não atende um RF de produto diretamente — é a infraestrutura que torna RF-01 a RF-15 (M1) implementáveis. Materializa três decisões de arquitetura que precisam nascer certas porque tudo em cima depende delas: o monolito modular com fronteiras impostas por lint (ADR-011), o scheduler durável em SQLite (ADR-004) e a operação 100% local no M1 (ADR-013). Também deixa o registry de tools desenhado como transport-agnostic desde o início, restrição de design que o ADR-014 (MCP, M2) exige da fundação mesmo sem implementar o servidor MCP agora.

## Escopo

- Scaffold do projeto: `package.json` (Node 22), TypeScript strict, Fastify, better-sqlite3, zod, pino; ESLint com `eslint-plugin-boundaries` impondo as fronteiras do ARCHITECTURE §2 (core nunca importa de modules; módulo só importa core e o contrato público de tasks; violação é erro de lint, não de review); Vitest com os gates de cobertura do TESTING.md; estrutura de pastas `src/core | src/modules | src/infra-ops | src/app.ts`.
- `core/kernel`: interface `ModuleManifest` (name, migrations, tools, commands, jobs, events, settingsDefaults, promptFragment) e o registro/composição dos módulos ativos. O registry de tools nasce transport-agnostic — a mesma declaração vai servir o tool use do brain e o servidor MCP no M2 (ADR-014). Fragmentos de prompt são concatenados em ordem determinística por nome de módulo (pré-requisito do prompt caching byte-estável do ADR-007, ainda não exercitado nesta feature).
- `core/db`: SQLite em modo WAL e runner de migrações por módulo (arquivos prefixados pelo nome do módulo, aplicados em ordem estável). Migrações base desta entrega: `messages`, `settings`, `jobs`.
- `core/scheduler`: poll de 30s na tabela `jobs`, catch-up de jobs vencidos no boot, recorrência que gera a próxima ocorrência só no momento do disparo, fuso `America/Sao_Paulo` explícito (ADR-004).
- `core/outbox`: fila de envio com confirmação só pós-2xx da Evolution, retry exponencial, delay aleatório de 10–45s + `sendPresence` antes de mensagens proativas (política anti-banimento), registro de `delivered_at`.
- `core/channel` + adapter `whatsapp-evolution`: `POST /webhook/evolution` com validação zod, segredo de webhook, filtro de JID (`OWNER_WHATSAPP_JID` — mensagem de qualquer outro JID é ignorada e logada, nunca processada), dedup por `wa_message_id`; envio via `sendText`; watchdog básico de `CONNECTION_UPDATE` registrando o estado da sessão.
- `modules/echo` (módulo de demonstração): command matcher determinístico — mensagem "ping" gera resposta "pong" via outbox. Prova kernel + commands + channel + outbox funcionando ponta a ponta sem nenhuma chamada de LLM. Remoção prevista assim que o primeiro módulo real (`tasks`, FEAT-002) chegar.
- `GET /health`: estado do DB, último tick do scheduler, estado da sessão WhatsApp, versão do build.
- `infra/docker-compose.yml` com os dois perfis do ADR-013: `local` (Evolution 2.3.7 pinada + Postgres/Redis exclusivos dela + brain, portas só em localhost, sem Caddy nem Litestream) e `producao` (perfil declarado com Caddy e Litestream, arquivos presentes mas não exercitados nesta entrega).
- CI: remove as condições de bootstrap do `ci.yml` que existiam só porque `package.json` ainda não existia.
- README: seção de setup local real — `cp .env.example .env`, `docker compose --profile local up`, pareamento do QR da Evolution com o chip do Norte, `npm run dev`, `npm test`.

## Fora de escopo

- Task-store real (entidades `items`/`reminders`/`events`) — fica para a FEAT-002; o `echo` é só prova de conceito do pipeline, não um módulo de domínio.
- Qualquer chamada a LLM ou triagem (Haiku/Sonnet) — o caminho ponta a ponta desta entrega é 100% determinístico, sem `core/llm`.
- STT/áudio — captura por áudio é RF-02, fora desta fatia.
- Cadeias de lembrete, rituais (briefing/revisão) e cobranças — dependem do task-store (FEAT-002+).
- Google Calendar — RF-12, módulo de integração próprio.
- Servidor MCP — entra no M2 (ADR-014); aqui vale só a restrição de design (registry transport-agnostic), não a implementação do servidor.
- Deploy em VPS — a operação desta entrega é 100% local (ADR-013); a migração é etapa do hardening do M1.

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| Módulo `echo` como prova de conceito do pipeline, com remoção já prevista | Provar o pipeline só com testes de integração, sem módulo de demonstração real | Um módulo real registrado no kernel via manifesto exercita o contrato de extensão (`commands`) de ponta a ponta, incluindo o lint de fronteiras — testes isolados não pegariam um manifesto malformado ou uma violação de import |
| Fronteiras de módulo impostas por `eslint-plugin-boundaries` desde o primeiro commit | Convenção documentada + review humano | ADR-011 já decidiu isso: a fronteira precisa ser verificada por ferramenta, não por disciplina — adiar o lint para depois significa nascer com uma dívida que a própria ADR proíbe |
| Registry de tools desenhado transport-agnostic já na fundação, sem implementar MCP | Adiar qualquer desenho de tools para quando o MCP for implementado no M2 | ADR-014 exige explicitamente que essa restrição valha desde a FEAT-001 — desenhar o registry acoplado ao tool use do brain agora custaria uma reescrita estrutural quando o MCP chegasse |

(Nenhuma decisão nova de arquitetura nesta feature — as três ADRs que ela materializa já estavam registradas antes da implementação.)

## Impacto técnico

- **Banco:** primeiras migrações do projeto — `messages`, `settings`, `jobs` (todas de `core/`, sem módulo de domínio ainda). Sem dado de cliente, sistema single-user; sem migração de dados existentes.
- **API:** `POST /webhook/evolution` (novo — único ponto de entrada HTTP externo, autenticado por segredo de webhook); `GET /health` (novo — sem autenticação, só estado operacional).
- **Frontend:** nenhum — interface é 100% WhatsApp.
- **Permissões:** sistema single-user; o único controle de acesso é o filtro de JID (`OWNER_WHATSAPP_JID`) na borda do webhook.
- **Áreas sensíveis tocadas** (gatilho de `security-auditor` obrigatório antes do merge): borda HTTP do webhook, filtro de JID, envio de mensagens pelo outbox (política anti-banimento), variáveis de ambiente/secrets.

## Testes

| Tipo | O que cobre |
|---|---|
| Unit | `core/kernel`: registro de manifesto, composição determinística de tools/commands/prompt a partir de múltiplos módulos. `core/scheduler` (domínio): catch-up de jobs vencidos no boot, geração de próxima ocorrência de recorrência, corretude cruzando meia-noite e virada de mês em `America/Sao_Paulo`. `core/outbox`: retry exponencial (contagem e backoff), confirmação só pós-2xx. |
| Integração | Via `fastify.inject()`, contra SQLite real: fluxo completo "ping" → "pong" (kernel+commands+channel+outbox); S7 (JID alheio ignorado e logado, nenhum efeito); S8 (dedup de `wa_message_id`, sem duplicar mensagem de saída); S9 (nenhum secret aparece em log — `AUTHENTICATION_API_KEY`, `wa_message_id` sensível etc.); S10 (payload malformado rejeitado com erro controlado, processo não cai). |
| Falha injetada | Restart do processo com job vencido na tabela `jobs`: catch-up dispara no boot, sem duplicar o que já tinha `delivered_at`. |
| Segurança/isolamento | Suite S1..S10 do TESTING.md §3 aplicável a esta entrega (S1, S2, S6, S7, S8, S9, S10 — S3/S4/S5 dependem de task-store/tools de domínio, ficam para FEAT-002+). |
| Lint como gate | `eslint-plugin-boundaries` roda no CI como gate obrigatório — violação de fronteira de módulo falha o build, não é achado de review. |

## Como validar manualmente

1. `docker compose --profile local up` e parear o QR code da Evolution com o chip dedicado do Norte.
2. Enviar "ping" a partir do número configurado em `OWNER_WHATSAPP_JID`: a resposta "pong" chega no WhatsApp.
3. Enviar "ping" de outro número: nenhuma resposta chega; o log mostra a mensagem ignorada.
4. Com um job de teste vencido na tabela `jobs`, derrubar o brain (`docker compose stop brain`) e religar: a mensagem represada sai assim que o processo sobe (catch-up no boot).
5. `GET /health`: confere que reflete DB ok, último tick do scheduler, estado da sessão WhatsApp e versão do build.

---

## Entrega (preencher no fim, antes do merge)

- **O que foi feito:** backend completo do escopo — scaffold (Node 22, TS strict, Fastify, better-sqlite3 WAL, zod, pino, ESLint com `eslint-plugin-boundaries`, Vitest); `core/kernel` (`ModuleManifest` com `events` incluído, `KernelRegistry` com composição determinística e `wireEvents` para o bus); `core/db` (WAL + runner de migrações com `down` testado); `core/scheduler` (poll 30s, catch-up no boot, recorrência TZ-aware `America/Sao_Paulo`); `core/outbox` (confirmação pós-2xx, retry exponencial com backoff persistido em `retry_after`, delay anti-banimento 10–45s + `sendPresence`, teto diário de proativas, alerta por e-mail ao esgotar retries); `core/channel` + adapter `whatsapp-evolution` (webhook validado, filtro de JID, dedup, `sendText`/`sendPresence`/`getBase64FromMediaMessage`, watchdog de `CONNECTION_UPDATE`); `modules/echo` (ping→pong); `GET /health`; `infra/` (docker-compose com perfis local/producao, Dockerfile, Caddyfile, litestream.yml); CI sem condições de bootstrap; README com setup local real.
- **PRs:** (preenchido pelo orquestrador ao abrir o PR)
- **Migrações:** `001_core_messages`, `002_core_settings`, `003_core_jobs`, `004_core_outbox_messages` — todas com `up`/`down` testados em `tests/unit/core-migrations.test.ts` e `tests/unit/migrator.test.ts`.
- **Pendências/débitos:**
  - `EmailAlerter` só loga em `error`; não há cliente SMTP/Resend real ainda — entra com RF-13 (fora de escopo desta feature).
  - `ConnectionWatchdog` é "básico" como a spec pede: registra o último estado, mas não dispara alerta por e-mail em sessão caída (também RF-13).
  - `core/mcp` (servidor MCP) não existe ainda — corretamente fora de escopo (M2, ADR-014); o registry de tools já nasce transport-agnostic (`ToolDefinition` com schema zod), que é a restrição exigida nesta fundação.
  - `eslint-plugin-boundaries` só resolve `import "./x.js"` para o `.ts` real com `import/resolver: typescript` configurado — sem isso a regra fica "cega" e não pega nenhuma violação (achado durante a validação manual do lint como gate; corrigido antes de fechar a entrega, com `eslint-import-resolver-typescript` adicionado como devDependency).
- **Aprendizados:**
  - `eslint-plugin-boundaries` não resolve extensão `.js`→`.ts` (padrão NodeNext/ESM) sem `settings['import/resolver']` apontando para `eslint-import-resolver-typescript`; sem isso todo import interno vira tipo "unknown" e a regra `element-types` nunca dispara — vale testar manualmente uma violação proposital sempre que este plugin for configurado do zero, porque o lint passa "verde" silenciosamente mesmo quebrado.
  - Fastify 5 + `exactOptionalPropertyTypes: true` exige anotar explicitamente o generic de logger (`FastifyBaseLogger`) ao passar uma instância `pino.Logger` via `loggerInstance` — a inferência automática colide por variância estrutural do método `child`.
