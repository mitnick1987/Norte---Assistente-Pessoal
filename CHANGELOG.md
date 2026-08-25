# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

<!-- Toda entrega adiciona bullets em [Não lançado], sob "Adicionado", "Alterado", "Corrigido", "Removido" ou "Segurança". A skill /release fecha a seção em uma versão SemVer com data. -->

## [Não lançado]

### Adicionado
- FEAT-001 (fundação): primeira fatia ponta a ponta do Norte — mensagem "ping" no WhatsApp responde "pong", sem LLM no caminho. Kernel modular com fronteiras impostas por lint (`eslint-plugin-boundaries`), scheduler durável em SQLite com catch-up no boot (ADR-004), outbox com confirmação pós-2xx e política anti-banimento, adapter Evolution com filtro de dono e dedup, `GET /health`, e `infra/docker-compose.yml` com perfis `local`/`producao` (ADR-013).
- Webhook da Evolution: o brain se autoprovisiona no boot (`webhook/set`, com retry); o segredo é validado em tempo constante e aceito também via query string, já que a Evolution 2.3.7 não garante entrega de headers customizados nesse endpoint (fallback documentado, nunca exposto em log).
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
- `.env.example`: adicionadas `EVOLUTION_POSTGRES_PASSWORD`, `PORT` e `DAILY_PROACTIVE_CAP`. Faltam ainda `HOST` e `BRAIN_WEBHOOK_URL` — o arquivo tem ACL restrita neste ambiente e não pôde ser editado nesta rodada; adição manual pendente antes do release (ver Entrega em `docs/features/FEAT-001-fundacao.md`).
- `README.md`: seção "Setup local" reescrita com o passo a passo real (Compose perfil `local` + override `docker-compose.local.yml`, pareamento do QR, `npm run dev`, teste do "ping").
- `GET /health`: versão do build resolvida a partir do `package.json` via `import.meta.url` (nunca mais cai em `0.0.0` quando o processo roda direto por `node dist/app.js`, sem `npm run`).
- Log estruturado (pino): serializer de `req` remove a query string da URL antes de logar (o segredo do webhook, quando vem via query string, nunca aparece no log de acesso); e-mail de alerta (PII do dono) removido do payload logado em `EmailAlerter`.
