# Norte — Instruções do Projeto

Assistente pessoal para TDAH que mora no WhatsApp: captura sem atrito, lembra na hora certa, cobra sem culpa e prioriza o dia por você.

## Leitura obrigatória antes de qualquer implementação

1. [docs/PRD.md](docs/PRD.md) — o que estamos construindo e por quê
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, modelo de dados, ADRs
3. [docs/SECURITY.md](docs/SECURITY.md) — autenticação, autorização, secrets, borda
4. [docs/TESTING.md](docs/TESTING.md) — pirâmide de testes e gates
5. [docs/process/DEVELOPMENT_PROCESS.md](docs/process/DEVELOPMENT_PROCESS.md) — como trabalhamos
6. [docs/process/CODE_STYLE.md](docs/process/CODE_STYLE.md) — estilo de código e de comentários

## Processo (resumo — detalhes no DEVELOPMENT_PROCESS.md)

- Toda feature segue o fluxo da skill `/feature`; todo bug segue `/bugfix`; refactor estrutural segue `/refactor` (comportamento preservado, testes de caracterização antes de mexer). Nada de código sem spec e sem teste — exceção única: a via rápida do DEVELOPMENT_PROCESS.md §1.1 (docs, copy, bumps; PR com CI verde).
- Feature nasce como issue com ID `FEAT-NNN`; bug, com `BUG-NNN`; refactor, com `REF-NNN`. Spec em `docs/features/` antes de codar; branch `feature/*`, `fix/*` ou `refactor/*` a partir de `main`, que é protegida.
- **Definition of Done:** código + testes passando + doc da feature em `docs/features/` + CHANGELOG atualizado. Sem isso, a entrega não existe.
- Commits em Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `chore:` — tabela completa no DEVELOPMENT_PROCESS.md §3), mensagens em português, imperativas e curtas.
- Merge só com OK do dono do projeto, CI verde e reviews resolvidos. Sem exceção: não há autorização de merge automático registrada.
- Entre o briefing e o merge, o fluxo é autônomo — inclusive o loop implementa→testa→corrige (workflow `implement-feature`). Não pare para pedir permissão; os pontos legítimos de parada estão no DEVELOPMENT_PROCESS.md §8.
- Decisão de arquitetura nova → registrar ADR via `/adr` antes de implementar.

## Regras inegociáveis de código

- **O LLM nunca é o registro** — toda escrita passa por tools strict validadas no backend (task-store em SQLite é a única fonte da verdade).
- **Deleção sempre lógica** (`dropada`/`arquivada`), nunca `DELETE` físico.
- **`adiamentos_count` nunca é exposto ao usuário** — existe só para a higiene automática da lista; exibi-lo é bug de produto (RSD).
- **TZ America/Sao_Paulo explícito** em todo armazenamento e cálculo de recorrência — sem exceção, sem depender do fuso do servidor.
- **Caminho crítico de lembretes sem LLM** — templates determinísticos, jobs duráveis; a API do Claude pode cair sem quebrar o valor diário.
- **Teto de proativas imposto no backend** (nunca só sugerido no prompt) — settings define o limite, o código o aplica.
- **Tom RSD-safe é requisito testado** — mensagem que soa crítica é bug, não nuance de copy; suite de regressão de tom roda no CI.
- **Nenhum comportamento proativo fora da tabela `jobs`** — cron em memória é proibido (ADR-004).
- **Nenhum secret em código ou em `.env` commitado** — só `.env.example` com as chaves.
- Validação de entrada em 100% das rotas; limites de negócio impostos **no backend**, nunca só na UI.
- Modo estrito de tipos habilitado; identificadores em inglês; comentários e docs em português.

## Estilo de comentários (regra do time)

Comentário existe para explicar **por quê** e restrições não óbvias — nunca para narrar o que a linha faz. Escreva como um dev experiente escreveria: direto, natural, sem cerimônia. Proibido: comentários redundantes ("incrementa o contador"), narração passo a passo, tom de assistente, emojis, e qualquer menção a IA/ferramenta geradora. `TODO` só com issue vinculada, no formato `TODO(#42)`. Se o código precisa de um comentário para ser entendido, primeiro tente reescrever o código. Detalhes no [CODE_STYLE.md](docs/process/CODE_STYLE.md).

## Time de agentes

Os papéis do time estão em `.claude/agents/` — use-os nas tarefas correspondentes: `backend-dev`, `frontend-dev`, `qa-engineer`, `security-auditor`, `code-reviewer`, `tech-writer`, `devops-engineer`. As skills de fluxo estão em `.claude/skills/`: `/feature`, `/bugfix`, `/refactor`, `/release`, `/adr`, `/handoff`. Quando a ferramenta Workflow está disponível, a implementação roda pelo workflow salvo `implement-feature` e o review de `/feature`, `/bugfix` e `/refactor` pelo `review-feature` (ambos em `.claude/workflows/`).

**Modelos:** implementadores rodam com Sonnet; `code-reviewer` e `security-auditor` rodam com Opus (definido no frontmatter de cada agente). O review nunca roda em modelo menor que Opus e nunca é pulado por indisponibilidade de modelo.
