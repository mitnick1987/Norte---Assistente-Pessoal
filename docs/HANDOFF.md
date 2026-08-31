# Handoff — Norte

**Data:** 2026-08-30 · **Commit:** `20cbbe4` (branch `main`) · **Marco:** M1 completo

## Estado em uma frase

M1 concluído: 8 features (FEAT-001..008) mergeadas em `main`, 127 arquivos de teste / 961 testes verdes, rodando localmente (ADR-013); falta migrar para o VPS e fechar a semana de operação com 100% de entrega antes de liberar o M2.

## 1. O que o Norte faz hoje

Tudo abaixo está implementado, testado e mergeado — não é plano, é o que existe no código em `main`.

- **Captura de texto e áudio com atrito zero.** Qualquer mensagem no WhatsApp (texto ou nota de voz) passa por triagem Haiku 4.5 (`modules/capture`) que classifica em `captura`/`comando`/`conversa` e devolve confirmação de uma linha, sem perguntar estrutura. Áudio transcreve via Groq (`whisper-large-v3-turbo`, primário) com fallback OpenAI Whisper (`core/stt`); falha total de STT pede o conteúdo por texto em tom RSD-safe. Data relativa ("sexta 14h", "amanhã") nunca é calculada pelo modelo — a triagem devolve a expressão literal e o backend resolve com `parseRelativeDatePtBr` em `America/Sao_Paulo` (ADR-006). Webhook responde imediatamente e processa em background, com varredura de recuperação no boot para mensagem interrompida por crash (ADR-018).
- **Task-store determinístico.** `modules/tasks`: tabela `items`, transições de estado validadas no domínio, deleção sempre lógica (`dropada`/`arquivada`, nunca `DELETE`), tools strict (`create_item`/`complete_item`/`snooze_item`/`drop_item`/`list_items`) e executor de comandos texto ("feito"/"adia"/"dropa"/"lista") sem LLM. Idempotência por `source_message_id` + `source_item_index` (índice único parcial).
- **Eventos e cadeias de lembrete contra cegueira temporal.** `modules/tasks` ganha a entidade `events`; `modules/chains` expande um compromisso com hora resolvida em até 3 lembretes (véspera, manhã, "hora de sair" com desconto de deslocamento), todos calculados em `America/Sao_Paulo`, descartando etapa que cairia no passado ou no próprio horário do compromisso. Alerta de saída é sempre tempo restante recalculado no disparo, nunca horário absoluto congelado. Drop/reagendamento do item propaga por `EventBus` (primeiro uso real do bus, ADR-011) — `tasks` não importa `chains`.
- **Google Calendar.** OAuth 2.0 com tokens cifrados em repouso (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`), escopo mínimo `calendar.events`, refresh automático com alerta por e-mail em falha. Leitura: `GET /setup/google` conduz o consentimento; a partir daí, perguntar pela agenda sincroniza compromissos do Google com as cadeias internas. Escrita: "marca dentista quinta 16h" cria o compromisso no Norte e no Google na mesma operação, pelo caminho determinístico (ADR-019, opção A) — falha do Google nunca trava nem aparece como erro ao dono, só o espelho remoto fica pendente.
- **Brain Sonnet conversacional com tool-use.** Mensagem classificada como `conversa` liga o Sonnet 5 de verdade: loop de tool-use manual (`core/llm/brain-loop.ts`, ADR-001), histórico recente de `messages` (só texto final, proativas nunca entram na janela), teto de 6 iterações com fallback determinístico. Tools disponíveis: as cinco de `tasks` + `create_event` do Google Calendar (idempotente por `source_message_id`, sem duplicar evento em reprocessamento). System prompt byte-estável com `cache_control: ephemeral` (ADR-007) — data/hora corrente só entra na última mensagem do usuário, nunca no system prompt.
- **Briefing matinal e revisão noturna com fallback determinístico.** `modules/rituals`: briefing (7h40 default) e revisão (21h30 default, no máximo 3 mensagens e uma decisão pedida). Dados coletados por funções puras (até 3 prioridades, micropasso por heurística de verbo); Sonnet só redige em cima — se falhar ou der timeout, cai no template determinístico com os mesmos dados. São rituais-âncora (`is_anchor_ritual`): prioridade na fila do outbox sobre proativas comuns, com alerta dedicado se mesmo assim ficarem represados pelo teto diário.
- **Fechamento de loop, próxima ação, modo retorno e higiene.** Quatro módulos 100% determinísticos (`modules/nudges`, `next-action`, `return-mode`, `hygiene`), nenhum passa por redação do Sonnet. Cobrança: job durável verifica elegibilidade (vencido ou top-3 do dia não confirmada) e manda menu "1 feito / 2 reagendar / 3 dropar", com teto próprio somado ao teto geral. "Qual a próxima?" devolve exatamente uma ação, nunca lista. Modo retorno: 48h sem mensagem de entrada suprime cobrança; reentrada dispara um resumo agregado único, nunca lista item a item. Higiene: item com `snoozeCount >= 3` ou parado ≥ 21 dias vira proposta de arquivar/dropar/adiar, anexada verbatim na revisão noturna (nunca reescrita pelo Sonnet — área mais sensível a RSD). Menu numérico 1/2/3 é desambiguado entre cobrança/revisão/higiene por uma tabela central (`core/menu`, `pending_menus`) — resolve sempre contra a última pergunta pendente.
- **Observabilidade.** E-mail de alerta real (SMTP via nodemailer ou Resend via fetch, prioridade SMTP), com anti-flood atômico por chave lógica. Dead man's switch externo (`HEALTHCHECKS_PING_URL`, ping a cada 5 min só quando o sistema está de fato saudável). Watchdog de sessão WhatsApp com alerta em queda/QR pendente (nunca em reconexão de rotina). `GET /health` honesto — 503 quando degradado, com grace period no boot. Monitor de custo horário: projeta gasto mensal a partir de tokens gravados em `messages`, alerta acima de US$25, mais um alarme de prioridade alta para regressão de prompt cache.
- **Tom RSD-safe testado em todo o produto.** `core/llm/tone-rules.ts` é bloco fixo do system prompt (nunca fragmento de módulo); suite dedicada em `tests/tone/` roda no CI como gate, não como sugestão de prompt.

## 2. Arquitetura em uma página

Monolito modular: `core/kernel` compõe os módulos a partir de um `ModuleManifest` (rotas, jobs, tools, `promptFragment`, `events`) com ordem determinística; fronteiras entre `core`/`modules`/`modules/*/public` impostas por `eslint-plugin-boundaries`, não por convenção. SQLite (better-sqlite3, WAL) é a única fonte da verdade — o LLM nunca escreve direto, toda escrita passa por tools validadas com zod no backend. Caminho crítico de lembretes (scheduler, outbox, templates) não depende do Claude estar no ar. Detalhe completo em [docs/ARCHITECTURE.md](ARCHITECTURE.md); decisões em [docs/adr/](adr/) (19 ADRs, todos com status `aceita`).

**`core/`** (fundação, sem dependência de `modules`):
`kernel` (registry + composição) · `db` (WAL + migrator com `up`/`down`) · `scheduler` (poll de 30s, catch-up no boot, recorrência TZ-aware) · `outbox` (confirmação pós-2xx, retry exponencial, delay anti-banimento, teto diário) · `channel` + adapter `whatsapp-evolution` (webhook, dedup, watchdog, autoprovisionamento) · `llm` (provider Anthropic plugável, loop de tool-use, system prompt byte-estável) · `stt` (router Groq/OpenAI) · `menu` (`pending_menus`, desambiguação de resposta numérica entre módulos) · `health` (`evaluateSystemHealth`, compartilhada entre `/health` e dead man's switch) · `bus` (EventBus com isolamento de erro por assinante) · `settings` · `env` · `logger`.

**`modules/`**: `tasks` (task-store + `events`) · `capture` (triagem, captura texto/áudio, brain-service) · `chains` (cadeias de lembrete) · `rituals` (briefing/revisão) · `nudges` (cobrança) · `next-action` · `return-mode` · `hygiene` · `integrations/google-calendar`.

**`infra-ops/`**: alertas por e-mail, dead man's switch, monitor de disco e de custo — mesmo padrão de manifesto que `modules`, mas categoria própria (observabilidade transversal, não domínio de produto).

**Migrações existentes:**
- `core/db/migrations`: `001_core_messages` .. `010_core_pending_menus` (10 migrações — inclui `007_core_jobs_cancelado_status`, que recria `jobs` por causa do `CHECK` do SQLite, e `008`/`009` para `is_proactive`/`is_anchor_ritual`).
- `modules/tasks/migrations`: `001_tasks_items` .. `006_tasks_events_gcal_id_unique` (6 migrações).
- `modules/nudges/migrations`: `001_nudges_patterns`, `002_nudges_charges`.
- `modules/integrations/google-calendar/migrations`: `001_google_calendar_auth_tokens`.
- `infra-ops/migrations`: `001_infra_ops_alert_dispatches`.

Todas com `down` testado.

## 3. Como rodar

Passo a passo completo e validado está no [README.md](../README.md) — não duplicado aqui. Resumo:

```
cp .env.example .env        # preencher as chaves (seção 4 abaixo)
docker compose -f infra/docker-compose.yml -f infra/docker-compose.local.yml --profile local up
npm ci && npm run dev       # hot reload fora do container
npm test                    # 127 arquivos, 961 testes
```

Perfil `local` (Compose): Evolution API + brain, sem Caddy/TLS/Litestream — é o único perfil exercitado até agora (ADR-013). Perfil `producao` (Caddy + TLS + Litestream + dead man's switch) existe desde a fundação mas nunca rodou de verdade; entra em uso na migração ao VPS, marcada como pré-requisito de saída do M1.

## 4. Pré-requisitos do dono para uso real

Chaves em `.env.example` a preencher — todas as citadas abaixo já estão documentadas no arquivo, exceto onde indicado:

- **Chip secundário do WhatsApp** (nunca o número pessoal — ADR-005) para parear com a Evolution.
- `ANTHROPIC_API_KEY` — motor de triagem (Haiku) e conversa (Sonnet).
- `GROQ_API_KEY` (STT primário) e opcionalmente `OPENAI_API_KEY` (fallback) — sem nenhuma das duas, áudio para de funcionar (texto continua normal).
- **Setup do Google Calendar**: criar app OAuth em modo **"In Production"** no Google Cloud Console (não "Testing" — refresh token de app em Testing expira em 7 dias, ADR-010), escopo `calendar.events` apenas. Preencher `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` e `TOKEN_ENCRYPTION_KEY`, depois completar o consentimento manual em `GET /setup/google`.
- Alertas por e-mail: `SMTP_URL` **ou** `RESEND_API_KEY` (qualquer um habilita envio real; sem nenhum, alerta cai em log `error`) + `ALERT_EMAIL` (destinatário).
- `HEALTHCHECKS_PING_URL` — dead man's switch externo; opcional, mas sem ele não há detecção de "o processo parou de rodar" fora do próprio processo.
- `EVOLUTION_API_KEY`, `EVOLUTION_POSTGRES_PASSWORD`, `EVOLUTION_WEBHOOK_SECRET` (≥ 32 caracteres), `OWNER_WHATSAPP_JID`.

**Divergência encontrada e corrigida nesta revisão:** `ALERT_EMAIL_FROM` é lida por `core/env.ts` (opcional, `z.string().email()`) e usada em `src/infra-ops/mailer.ts`/`build-mailer.ts` para resolver o remetente do SMTP (evita usar o From fixo do sandbox do Resend, que falha SPF/DKIM em silêncio) — mas não consta no `.env.example`. É pendência conhecida desde a entrega da FEAT-008 (ACL de edição do arquivo ficou restrita durante aquela sessão); segue pendente. Adicionar manualmente:
```
ALERT_EMAIL_FROM=
```

## 5. Débitos e armadilhas conhecidos

**Issues abertas:**
- **#2 — BUG-001**: primeiro retry do outbox espera ~2 min em vez do esperado, porque o expoente do backoff é aplicado a `attempts` já pós-incremento.
- **#4 — REF-001**: status `'sent'` no `CHECK` da tabela `jobs` não é usado por nenhum código — candidato a remoção.
- **#22 — REF-002**: índice único de idempotência de `items` (`source_message_id` + `source_item_index`) não cobre a combinação com `source_item_index NULL` — é exatamente o caso do `create_event` do brain (FEAT-006), que nunca grava `source_item_index`. A idempotência hoje depende só de `findBySourceMessageId` em código, sem reforço de constraint contra concorrência real (dois disparos simultâneos do mesmo `source_message_id`, não só reprocessamento sequencial).

**Decisões de integração aceitas mas não implementadas (M2/M3):** ADR-014 (servidor MCP para Claude Code/Codex operarem o Norte), ADR-015 (Norte disparando trabalho nos CLIs de agente), ADR-016 (canal API nativo estilo gateway local, para IDEs de IA apontarem direto), ADR-017 (contas Claude/ChatGPT logadas como provedores de modelo, não só API key). As quatro têm ADR aceito e desenho pronto, zero código — são trabalho de M2/M3, não dívida do M1.

**Outras armadilhas registradas nas entregas das features (ver seção Entrega de cada spec para o detalhe completo):**
- Migração para VPS (perfil `producao` do Compose) ainda não aconteceu — é pré-requisito de saída do M1 (ADR-013), e as metas de confiabilidade do PRD (99,5% de entrega, downtime ≤ 5 min) só valem a partir dela.
- IDs de modelo (`claude-sonnet-5`, modelo Haiku de triagem) são constantes de configuração no código, não validados contra a API real da Anthropic — um ID incorreto ou descontinuado só se revela no primeiro erro de chamada real, não em boot nem em teste (FEAT-002, FEAT-006).
- Ajuste de horário de briefing/revisão em `settings` só é lido pelo scheduler no próximo restart do processo — não há reagendamento em runtime (FEAT-006).
- Preços de Sonnet/Haiku no monitor de custo usam o preço introdutório do Sonnet 5 (vigente até 31/08/2026) — expira em dois dias a partir da data deste handoff; ajustar via `settings` quando o preço cheio entrar em vigor, sem precisar de deploy (FEAT-008).
- `docker healthcheck` do `infra/docker-compose.yml` consome `/health` e espera `r.ok`; o 503 novo (FEAT-008) nunca foi validado num container Docker real, só via testes de integração com Fastify injetado.
- `CONTRIBUTING.md` ainda descreve o setup como "o código nasce na FEAT-001... não há ambiente para subir ainda" — desatualizado desde que a FEAT-001 mergeou; o README.md tem o passo a passo real e atualizado. Vale revisar o CONTRIBUTING.md numa próxima passada de documentação.

## 6. O que vem depois

M2/M3 do PRD (ver [docs/PRD.md](PRD.md) para os requisitos completos): captura por foto/vision, micropassos mais elaborados, memória de longo prazo (facts sobre o usuário), integração Gmail, servidor MCP (ADR-014) e canal API nativo (ADR-016) para IDEs/agentes de código, orquestração de CLIs de agente pelo Norte (ADR-015), contas Claude/ChatGPT como provedores de modelo (ADR-017), rastreio de boletos, proatividade adaptativa aos horários reais de resposta do usuário (além do `patterns` mínimo que `nudges` já usa para reagendamento).

Pré-requisito imediato antes de qualquer M2: migrar para o VPS (perfil `producao`) e fechar uma semana de operação com 100% de entrega — é o critério de saída do M1 (ADR-013).
