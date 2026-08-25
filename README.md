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

O código nasce na `FEAT-001`. Por enquanto, o repo é só documentação — clone e leia os docs na ordem do [CONTRIBUTING.md](CONTRIBUTING.md).

Quando o código existir (a partir da FEAT-001):

```
npm ci
cp .env.example .env
npm run dev
npm test
```

Docker Compose (VPS, `infra/`) é criado na FEAT-001 junto com a fundação do backend.

## Contribuindo

Leia o [CONTRIBUTING.md](CONTRIBUTING.md). Resumo: toda mudança nasce de uma issue (`FEAT-NNN`/`BUG-NNN`), tem spec antes de código, testes, review e entrada no CHANGELOG — as skills `/feature` e `/bugfix` guiam o fluxo.
