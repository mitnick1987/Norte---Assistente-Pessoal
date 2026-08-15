# Contribuindo com {{PROJETO}}

Guia de onboarding. Meta: você entender o projeto e entregar sua primeira mudança seguindo o processo, sem depender de ninguém.

## 1. Leia nesta ordem

1. [README.md](README.md) — o que é o projeto (5 min)
2. [docs/PRD.md](docs/PRD.md) — o produto: personas, requisitos (20 min)
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, modelo de dados, ADRs (20 min)
4. [docs/SECURITY.md](docs/SECURITY.md) — autenticação, autorização, secrets — **as regras inegociáveis** (15 min)
5. [docs/process/DEVELOPMENT_PROCESS.md](docs/process/DEVELOPMENT_PROCESS.md) — como trabalhamos (10 min)
6. [docs/process/CODE_STYLE.md](docs/process/CODE_STYLE.md) — estilo de código e comentários (10 min)
7. `docs/HANDOFF.md` — estado atual do projeto (se existir; gerado por `/handoff`)

## 2. O essencial em 30 segundos

- Toda feature: issue com ID `FEAT-NNN` (bug: `BUG-NNN`) → spec em `docs/features/` → branch `feature/*` ou `fix/*` → implementação com testes → review → CHANGELOG → PR. A skill `/feature` guia o fluxo inteiro.
- **Definition of Done:** código + testes + review + doc da feature + CHANGELOG. Sem os cinco, não está pronto (checklist completo no [DEVELOPMENT_PROCESS.md §2](docs/process/DEVELOPMENT_PROCESS.md)).
- `main` é protegida; merge só com OK do dono do projeto, CI verde e reviews resolvidos.
- Nenhum secret em código; validação de entrada em todas as rotas; limites de negócio no backend, nunca só na UI. As regras inegociáveis do domínio estão no [CLAUDE.md](CLAUDE.md).
- Commits: Conventional Commits em português, descrição ≤ 72 caracteres, `Refs #issue` no rodapé.
- Comentários: só porquês, em português, tom natural de dev — nada de narração nem comentário óbvio.

## 3. Trabalhando com o Claude Code

O repo traz um "time" configurado em `.claude/`:

- **Skills (fluxos):** `/feature`, `/bugfix`, `/release`, `/adr`, `/handoff` — use-as em vez de improvisar o processo.
- **Agentes (papéis):** backend-dev, frontend-dev, qa-engineer, security-auditor, code-reviewer, tech-writer, devops-engineer — as skills os acionam nos momentos certos.
- O `CLAUDE.md` na raiz dá o contexto a qualquer sessão nova.

Não usa Claude? O processo é o mesmo — os documentos de `docs/process/` descrevem tudo de forma independente de ferramenta.

## 4. Setup local

<!-- ADAPTE: preencha com os comandos reais do projeto: clone, subida do ambiente local, migrações, seeds e execução dos testes. -->

## 5. Dúvidas

Divergência entre documentação e código é bug de documentação: abra issue com label `docs` (ou corrija no próprio PR).
