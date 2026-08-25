# Norte

Assistente pessoal para TDAH que mora no WhatsApp: captura sem atrito, lembra na hora certa, cobra sem culpa e prioriza o dia por você.

Stack: a definida em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentação

- [docs/PRD.md](docs/PRD.md) — o que estamos construindo e por quê
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, modelo de dados, ADRs
- [docs/SECURITY.md](docs/SECURITY.md) — autenticação, autorização, secrets, borda
- [docs/TESTING.md](docs/TESTING.md) — pirâmide de testes e gates
- [docs/process/DEVELOPMENT_PROCESS.md](docs/process/DEVELOPMENT_PROCESS.md) — como trabalhamos
- [docs/process/CODE_STYLE.md](docs/process/CODE_STYLE.md) — estilo de código e de comentários
- [CONTRIBUTING.md](CONTRIBUTING.md) — onboarding: por onde começar
- [CHANGELOG.md](CHANGELOG.md) — histórico de mudanças

Specs de feature em `docs/features/`; decisões de arquitetura em `docs/adr/`.

## Setup local

Pré-requisitos: Node 22, Docker Desktop (perfil `local` do Compose — ADR-013).

1. Configure os segredos:

   ```
   cp .env.example .env
   ```

   Preencha pelo menos `EVOLUTION_API_KEY`, `EVOLUTION_POSTGRES_PASSWORD`, `EVOLUTION_WEBHOOK_SECRET` (≥ 32 caracteres) e `OWNER_WHATSAPP_JID` (o número do dono, formato `55DDDNUMERO@s.whatsapp.net`).

2. Suba a Evolution API e o brain (perfil local — sem Caddy, sem Litestream, portas só em `localhost`). O arquivo `docker-compose.local.yml` é o que publica a porta do painel da Evolution — nunca combinar esse override em produção:

   ```
   docker compose -f infra/docker-compose.yml -f infra/docker-compose.local.yml --profile local up
   ```

3. Pareie o WhatsApp: abra o painel da Evolution (`http://localhost:8080`) com a `EVOLUTION_API_KEY`, crie/abra a instância configurada em `EVOLUTION_INSTANCE` e escaneie o QR code com o **chip dedicado do Norte** — nunca o número pessoal (ADR-005). O brain se autoprovisiona no webhook da Evolution assim que sobe (retry com backoff enquanto a Evolution não responde) — não é preciso configurar nada manualmente no painel.

4. Para desenvolver fora do container (hot reload):

   ```
   npm ci
   npm run dev
   ```

5. Envie "ping" pelo WhatsApp a partir do `OWNER_WHATSAPP_JID`: a resposta "pong" confirma o pipeline ponta a ponta (kernel + commands + channel + outbox, sem LLM).

6. Testes:

   ```
   npm test
   ```

O perfil `producao` do Compose (Caddy + TLS + Litestream) existe desde a fundação mas só é exercitado a partir da migração para o VPS, no hardening do M1 (ADR-013).

## Contribuindo

Leia o [CONTRIBUTING.md](CONTRIBUTING.md). Resumo: toda mudança nasce de uma issue (`FEAT-NNN`/`BUG-NNN`), tem spec antes de código, testes, review e entrada no CHANGELOG — as skills `/feature` e `/bugfix` guiam o fluxo.
