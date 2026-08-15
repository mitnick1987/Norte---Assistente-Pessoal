# {{PROJETO}} — Instruções do Projeto

{{DESCRICAO}} <!-- ADAPTE: descrição de uma linha do produto. A stack (backend, frontend, banco, infra) está detalhada em docs/ARCHITECTURE.md — não repita aqui o que muda lá. -->

## Leitura obrigatória antes de qualquer implementação

1. [docs/PRD.md](docs/PRD.md) — o que estamos construindo e por quê
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, modelo de dados, ADRs
3. [docs/SECURITY.md](docs/SECURITY.md) — autenticação, autorização, secrets, borda
4. [docs/TESTING.md](docs/TESTING.md) — pirâmide de testes e gates
5. [docs/process/DEVELOPMENT_PROCESS.md](docs/process/DEVELOPMENT_PROCESS.md) — como trabalhamos
6. [docs/process/CODE_STYLE.md](docs/process/CODE_STYLE.md) — estilo de código e de comentários

## Processo (resumo — detalhes no DEVELOPMENT_PROCESS.md)

- Toda feature segue o fluxo da skill `/feature`; todo bug segue `/bugfix`. Nada de código sem spec e sem teste.
- Feature nasce como issue com ID `FEAT-NNN`; bug, com `BUG-NNN`. Spec em `docs/features/` antes de codar; branch `feature/*` ou `fix/*` a partir de `main`, que é protegida.
- **Definition of Done:** código + testes passando + doc da feature em `docs/features/` + CHANGELOG atualizado. Sem isso, a entrega não existe.
- Commits em Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `chore:` — tabela completa no DEVELOPMENT_PROCESS.md §3), mensagens em português, imperativas e curtas.
- Merge só com OK do dono do projeto, CI verde e reviews resolvidos. <!-- ADAPTE: o dono do projeto pode autorizar merge automático quando CI verde + reviews resolvidos; registre essa autorização aqui. -->
- Decisão de arquitetura nova → registrar ADR via `/adr` antes de implementar.

## Regras inegociáveis de código

<!-- ADAPTE: liste aqui as regras inegociáveis do domínio deste projeto. Exemplos reais de outros projetos: dinheiro sempre em centavos inteiros, nunca float; toda tabela com dado de cliente nasce com isolamento habilitado + teste. -->

- **Nenhum secret em código ou em `.env` commitado** — só `.env.example` com as chaves.
- Validação de entrada em 100% das rotas; limites de negócio impostos **no backend**, nunca só na UI.
- Modo estrito de tipos habilitado; identificadores em inglês; comentários e docs em português.

## Estilo de comentários (regra do time)

Comentário existe para explicar **por quê** e restrições não óbvias — nunca para narrar o que a linha faz. Escreva como um dev experiente escreveria: direto, natural, sem cerimônia. Proibido: comentários redundantes ("incrementa o contador"), narração passo a passo, tom de assistente, emojis, e qualquer menção a IA/ferramenta geradora. `TODO` só com issue vinculada, no formato `TODO(#42)`. Se o código precisa de um comentário para ser entendido, primeiro tente reescrever o código. Detalhes no [CODE_STYLE.md](docs/process/CODE_STYLE.md).

## Time de agentes

Os papéis do time estão em `.claude/agents/` — use-os nas tarefas correspondentes: `backend-dev`, `frontend-dev`, `qa-engineer`, `security-auditor`, `code-reviewer`, `tech-writer`, `devops-engineer`. As skills de fluxo estão em `.claude/skills/`: `/feature`, `/bugfix`, `/release`, `/adr`, `/handoff`. O review de `/feature` e `/bugfix` roda pelo workflow salvo `review-feature` (`.claude/workflows/`) quando a ferramenta Workflow está disponível.

**Modelos:** implementadores rodam com Sonnet; `code-reviewer` e `security-auditor` rodam com Opus (definido no frontmatter de cada agente). O review nunca roda em modelo menor que Opus e nunca é pulado por indisponibilidade de modelo.
