# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

<!-- Toda entrega adiciona bullets em [Não lançado], sob "Adicionado", "Alterado", "Corrigido", "Removido" ou "Segurança". A skill /release fecha a seção em uma versão SemVer com data. -->

## [Não lançado]

### Adicionado
- FEAT-001 (fundação, backend): scaffold Node 22 + TypeScript strict + Fastify + better-sqlite3 (WAL) + zod + pino; ESLint com `eslint-plugin-boundaries` impondo as fronteiras `core`/`modules` do ARCHITECTURE.md §2 como gate de CI (não de review); Vitest com gates de cobertura do TESTING.md.
- `core/kernel`: `ModuleManifest` (migrations, tools, commands, jobs, events, settingsDefaults, promptFragment) e `KernelRegistry` com composição determinística por nome de módulo — pré-requisito do prompt caching byte-estável (ADR-007) e do registry de tools transport-agnostic (ADR-014).
- `core/db`: SQLite WAL, runner de migrações por módulo com `down` testado; migrações base `messages`, `settings`, `jobs`, `outbox_messages`.
- `core/scheduler`: poll de 30s + catch-up de jobs vencidos no boot, recorrência (diária/semanal/mensal) calculada em `America/Sao_Paulo` no momento do disparo (ADR-004).
- `core/outbox`: fila de envio com confirmação só pós-2xx, retry exponencial, delay aleatório de 10–45s + `sendPresence` antes de proativas, teto diário de mensagens proativas imposto no backend.
- `core/channel` + adapter `whatsapp-evolution`: `POST /webhook/evolution` (validação zod, segredo de webhook, filtro de instância, filtro de `OWNER_WHATSAPP_JID`, dedup por `wa_message_id`), `sendText`/`sendPresence`/`getBase64FromMediaMessage`, watchdog de `CONNECTION_UPDATE`.
- `modules/echo`: comando determinístico "ping" → "pong" via outbox, prova de conceito do pipeline ponta a ponta sem LLM (remoção prevista na FEAT-002).
- `GET /health`: estado do DB, último tick do scheduler, estado da sessão WhatsApp, versão do build.
- `infra/docker-compose.yml` com perfis `local` e `producao` (ADR-013), `Caddyfile` e `litestream.yml` (perfil `producao`, não exercitados no M1).
- Fundação documental do Norte: PRD, arquitetura modular, segurança, testes, ADRs 001–012 e instanciação do template de processo.
- Fluxo `/refactor` (`REF-NNN`): refactor estrutural com testes de caracterização antes de mexer, passos pequenos e comportamento preservado; review pelo mesmo workflow `review-feature`. Inclui template de issue `refactor`.
- `.github/dependabot.yml`: atualização automatizada de dependências (GitHub Actions + npm da raiz, agrupamento minor/patch, major exige review humano), cumprindo a política do SECURITY.md §6.
- Procedimento de rollback no pós-release (`/release` §5): smoke falhou → re-deploy da tag anterior + reversão de migração + incidente registrado como BUG.
- Workflow `implement-feature`: loop autônomo implementa→testa→corrige com teto de voltas e escalada apenas por decisão humana; usado pelo `/feature` §4.
- Processo: política de autonomia e pontos de parada (DEVELOPMENT_PROCESS.md §8) — o fluxo não pede permissão entre etapas; aprovação de spec só bloqueia quando há pergunta de produto/escopo em aberto.
- Proporcionalidade (DEVELOPMENT_PROCESS.md §1.1): via rápida para mudança sem efeito em produção (docs, copy, bumps) e aprovação de spec bloqueante quando o impacto é alto (ADR, área sensível, escopo grande).
- Produção realimenta o backlog: alerta disparado ou erro recorrente vira issue `BUG-NNN` (processo §1 e agente devops-engineer).
- Gate humano de merge: PR com seção "Onde olhar primeiro" e reporte de entrega com "onde olhar em 5 minutos".

### Alterado
- Processo: seção "Sessões longas e contexto dos agentes" no DEVELOPMENT_PROCESS.md (§7) — re-âncora da spec/Definition of Done antes de fechar, leitura de arquivos por trecho, quebra de tarefas longas e delegação por ponteiros; regra replicada nas skills de fluxo e nos agentes implementadores.
- `.github/workflows/ci.yml`: removidas as condições de bootstrap (`hashFiles('package.json')`) agora que o scaffold da FEAT-001 existe — lint, typecheck, testes e build rodam incondicionalmente.
- `.env.example`: adicionadas `EVOLUTION_POSTGRES_PASSWORD`, `PORT` e `DAILY_PROACTIVE_CAP`, exigidas pelo boot do brain e pelo Compose local.
- `README.md`: seção "Setup local" reescrita com o passo a passo real (Compose perfil `local`, pareamento do QR, `npm run dev`, teste do "ping").
