# Norte

Assistente pessoal para TDAH que mora no WhatsApp: captura sem atrito, lembra na hora certa, cobra sem culpa e prioriza o dia por você.

Stack: a definida em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentação

- [docs/HANDOFF.md](docs/HANDOFF.md) — estado real do projeto agora: o que funciona, débitos, como assumir
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

   Preencha pelo menos `EVOLUTION_API_KEY`, `EVOLUTION_POSTGRES_PASSWORD`, `EVOLUTION_WEBHOOK_SECRET` (≥ 32 caracteres), `OWNER_WHATSAPP_JID` (o número do dono, formato `55DDDNUMERO@s.whatsapp.net`), `ANTHROPIC_API_KEY` (triagem e brain) e `GROQ_API_KEY` (transcrição de áudio). `GOOGLE_*` (agenda) e `SMTP_URL`/`RESEND_API_KEY` + `ALERT_EMAIL` (alertas) são opcionais e podem ser configurados depois.

2. Suba a Evolution API e o brain (perfil local — sem Caddy, sem Litestream, portas só em `localhost`). O arquivo `docker-compose.local.yml` é o que publica a porta do painel da Evolution — nunca combinar esse override em produção. Passe `--env-file .env` explícito: rodando da raiz com `-f infra/...`, o Compose procura o `.env` no diretório dos arquivos (`infra/`), não na raiz — sem o flag, a interpolação dos segredos falha com `required variable ... is missing`:

   ```
   docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.local.yml --profile local up
   ```

   Se a porta `8080` já estiver ocupada por outro serviço na sua máquina, troque o mapeamento em `docker-compose.local.yml` (ex.: `127.0.0.1:8765:8080`) — o brain fala com a Evolution pela rede interna, então mudar a porta do host não afeta o funcionamento.

3. Pareie o WhatsApp: abra o painel da Evolution (`http://localhost:8080`, ou a porta que você escolheu) com a `EVOLUTION_API_KEY`, crie/abra a instância configurada em `EVOLUTION_INSTANCE` e escaneie o QR code com o **chip dedicado do Norte** — nunca o número pessoal (ADR-005). O brain se autoprovisiona no webhook da Evolution assim que sobe (retry com backoff enquanto a Evolution não responde) — não é preciso configurar nada manualmente no painel.

4. Para desenvolver fora do container (hot reload):

   ```
   npm ci
   npm run dev
   ```

5. Envie uma mensagem pelo WhatsApp a partir do `OWNER_WHATSAPP_JID` — ex.: *"lembra de pagar o boleto sexta 14h"*. O Norte confirma a captura em uma linha (triagem Haiku → task-store); *"me mostra tudo"* lista os itens; *"feito"* conclui o mais recente. Uma nota de voz com vários assuntos vira vários itens numa resposta. Mensagens de qualquer número diferente do `OWNER_WHATSAPP_JID` são ignoradas (filtro de dono, ADR-005).

6. Testes:

   ```
   npm test
   ```

O perfil `producao` do Compose (Caddy + TLS + Litestream) existe desde a fundação mas só é exercitado a partir da migração para o VPS, no hardening do M1 (ADR-013).

## Contribuindo

Leia o [CONTRIBUTING.md](CONTRIBUTING.md). Resumo: toda mudança nasce de uma issue (`FEAT-NNN`/`BUG-NNN`), tem spec antes de código, testes, review e entrada no CHANGELOG — as skills `/feature` e `/bugfix` guiam o fluxo.
