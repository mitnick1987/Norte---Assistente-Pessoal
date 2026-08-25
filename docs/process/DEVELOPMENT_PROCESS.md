# Processo de Desenvolvimento — Norte

**Versão:** 1.0 · **Data:** 2026-08-25

Processo padrão para toda mudança no código. O objetivo é que **qualquer dev que pegue o projeto amanhã** entenda o que foi feito, por quê, e consiga continuar sem perguntar nada a ninguém.

---

## 1. Fluxo de uma feature

```
Backlog → Spec → Branch → Implementação (TDD) → Review → Merge → Changelog
```

1. **Backlog:** toda feature nasce como issue no GitHub com o label `feature` e recebe um ID `FEAT-NNN` (sequencial). Bugs recebem `BUG-NNN`; refactors estruturais recebem `REF-NNN` e seguem a skill `/refactor` (mesmo rito, com testes de caracterização antes de mexer). Os templates em `.github/ISSUE_TEMPLATE/` já trazem os campos exigidos; issue em branco está desabilitada.
2. **Spec:** antes de codar, criar `docs/features/FEAT-NNN-slug.md` a partir do [_TEMPLATE.md](../features/_TEMPLATE.md). A spec diz **o que** será feito, **por quê**, escopo, fora de escopo, e como validar. Specs pequenas (1 página) são melhores que specs grandes.
3. **Branch:** a partir de `main`: `feature/FEAT-NNN-slug` ou `fix/BUG-NNN-slug`. `main` é protegida — nada de commit direto.
4. **Implementação:** teste primeiro sempre que possível (no mínimo: nenhuma lógica de negócio sem teste unitário; nenhuma rota crítica sem teste de integração — ver [TESTING.md](../TESTING.md)).
5. **Review (obrigatório, mesmo trabalhando solo):**
   - `code-reviewer` revisa o diff completo (qualidade, estilo, aderência à arquitetura);
   - `security-auditor` revisa **sempre que** o diff tocar em: auth, permissões, queries sobre dados sensíveis, upload, ou variáveis de ambiente/secrets; e nas áreas sensíveis específicas do Norte — webhook da Evolution/borda HTTP, autenticação e filtro de JID do dono, tokens OAuth e cifra (`auth_tokens`), escopos Google, envio de mensagens/outbox (política anti-banimento), manuseio de mídia (`getBase64FromMediaMessage`), variáveis de ambiente/secrets, e o system prompt de tom (RF-14 — mudanças no tom passam por review com a suite de regressão);
   - com a ferramenta Workflow do Claude Code disponível, a etapa roda pelo workflow salvo `review-feature` (`.claude/workflows/`): reviewers em paralelo e cada achado passa por verificação adversarial antes de ser reportado;
   - achados são corrigidos **antes** do merge.
6. **PR:** aberto no GitHub mesmo em solo — é o registro histórico. Descrição preenchida com o template (O que muda / Por quê / Como testar / Checklist). CI verde é gate.
7. **Merge:** squash merge com mensagem conventional, branch deletada. Gate = CI verde + reviews resolvidos + **OK do dono do projeto**. Sem exceção: não há autorização de merge automático registrada — o dono aprova todo merge.
8. **Pós-merge:** doc da feature atualizada com o estado final (seção "Entrega"), CHANGELOG atualizado.
9. **Produção realimenta o backlog:** alerta disparado, erro recorrente no error tracking ou falha de smoke pós-deploy vira issue `BUG-NNN` (com link do alerta/erro) e entra pelo `/bugfix`. Erro de produção sem issue é incidente invisível.

### 1.1 Proporcionalidade — rigor na medida do risco

O rito completo existe para mudança que pode quebrar comportamento. Nos extremos, o rigor muda:

- **Via rápida (lista fechada):** mudança sem efeito em comportamento de produção — docs, texto/copy sem lógica, bump patch/minor de dependência, ajuste de CI — vai por PR com CI verde, sem spec, sem QA e sem workflow de review; o merge segue a regra normal. É a única exceção ao Definition of Done (§2). Commit no tipo certo (`docs:`, `chore:`); CHANGELOG só se visível a quem usa/opera. Na dúvida se é via rápida, não é: rito completo.
- **Spec de alto impacto bloqueia:** por padrão a implementação segue logo após o resumo da spec (§8), mas espera o OK explícito do dono quando a spec envolve decisão de arquitetura nova (ADR), toca área sensível (gatilhos do security-auditor) ou tem escopo grande (vários módulos, mais que alguns dias de trabalho). Errar barato é seguir; errar caro é esperar.

## 2. Definition of Done (checklist de toda entrega)

- [ ] Spec em `docs/features/` criada/atualizada (incl. seção **Entrega** com o que de fato foi feito)
- [ ] Código com testes: unit (lógica), integração (rotas/repos) e as suites específicas da área tocada (ver [TESTING.md](../TESTING.md))
- [ ] Suite completa verde no CI (lint, typecheck, testes, security scans)
- [ ] Review do `code-reviewer` (e `security-auditor` quando aplicável) com achados resolvidos
- [ ] CHANGELOG.md atualizado na seção `[Não lançado]`
- [ ] Sem TODO órfão: todo `TODO` no código referencia uma issue (`// TODO(#42): ...`)
- [ ] Migração de banco (se houver) é reversível e testada no CI do zero

## 3. Commits — Conventional Commits em português

Formato: `tipo(escopo): descrição no imperativo`

| Tipo | Uso |
|---|---|
| `feat` | Nova funcionalidade visível |
| `fix` | Correção de bug |
| `refactor` | Mudança de código sem mudar comportamento |
| `test` | Só testes |
| `docs` | Só documentação |
| `chore` | Build, CI, dependências, infra |
| `perf` | Melhoria de performance |

Exemplos:
```
feat(users): adiciona confirmação de e-mail no cadastro
fix(api): corrige paginação quando a última página está vazia
docs(features): registra entrega da FEAT-012
```

Regras: descrição ≤ 72 caracteres, corpo explica o **porquê** quando não for óbvio, referência à issue no rodapé (`Refs #42`). Um commit = uma mudança lógica; commits "wip" são squashados antes do merge.

## 4. Branches e releases

- `main` — sempre deployável; branch protection: CI verde + PR obrigatórios.
- `feature/*`, `fix/*`, `refactor/*` — vida curta (dias, não semanas). Feature grande → quebrar em PRs menores atrás de flag; refactor grande → PRs incrementais em que o código novo convive com o antigo (strangler fig), sistema sempre deployável.
- **Versionamento SemVer** (`v0.x.y` até o launch). Release = tag anotada + seção nova no CHANGELOG (skill `/release` faz isso).
- Deploy: merge em `main` → staging automático; tag → produção, conforme pipeline descrito no [TESTING.md](../TESTING.md).

## 5. Documentação por entrega (o que fica escrito, onde)

| Artefato | Onde | Quando |
|---|---|---|
| Spec + registro de entrega | `docs/features/FEAT-NNN-*.md` (ou `REF-NNN-*`) | Toda feature/bug/refactor relevante |
| Decisão de arquitetura | `docs/adr/NNNN-*.md` | Sempre que escolhermos entre alternativas com impacto duradouro |
| Mudanças por versão | `CHANGELOG.md` | Todo PR mergeado |
| Estado geral p/ handoff | `docs/HANDOFF.md` (gerado por `/handoff`) | Fim de milestone ou troca de dev |
| Comentários no código | Inline | Só para explicar porquês não óbvios — ver [CODE_STYLE.md](CODE_STYLE.md) |

## 6. Papéis do time (agentes em `.claude/agents/`)

| Agente | Responsabilidade | Quando entra |
|---|---|---|
| `backend-dev` | Módulos de backend, domínio, banco e integrações | Implementação de API/domínio |
| `frontend-dev` | UI, páginas, componentes e integração com a API | Implementação de UI |
| `qa-engineer` | Estratégia e escrita de testes; guardião das suites críticas | Junto com toda implementação |
| `security-auditor` | Review de segurança do diff (auth, permissões, secrets, OWASP) | Diffs sensíveis (ver §1.5) |
| `code-reviewer` | Review de qualidade/arquitetura de todo PR | Todo PR, antes do merge |
| `tech-writer` | Docs de feature, CHANGELOG, guias | Toda entrega |
| `devops-engineer` | Pipeline de CI/CD, containers, infraestrutura, observabilidade | Infra e pipeline |

**Modelos:** implementadores rodam com Sonnet; `code-reviewer` e `security-auditor` rodam com Opus (definido no frontmatter de cada agente). O review nunca roda em modelo menor que Opus e nunca é pulado por indisponibilidade de modelo.

O fluxo completo é orquestrado pelas skills **`/feature`**, **`/bugfix`** (correções) e **`/refactor`** (mudanças estruturais) — use-as em vez de improvisar o processo.

## 7. Sessões longas e contexto dos agentes

Modelos perdem precisão sobre o que está no meio de um contexto longo ("lost in the middle"). O processo já reduz isso por design — docs curtos e fragmentados, subagentes com contexto limpo por tarefa, estado gravado em arquivo (specs, HANDOFF.md) em vez de na conversa. Regras que completam a proteção:

- **Re-âncora antes de fechar:** em tarefa longa, releia a spec e o Definition of Done (§2) antes do commit final e do PR. O que foi lido no início da sessão é exatamente o que mais se perde.
- **Arquivo grande se lê por trecho:** carregue a parte relevante, não o arquivo inteiro. Varredura ampla do repositório → delegue a um subagente de exploração, que devolve só a conclusão.
- **Tarefa que não cabe numa sessão se quebra:** PRs menores atrás de flag (§4) ou etapas com registro intermediário. Fim de sessão com trabalho aberto → `/handoff` ou seção Entrega parcial na spec — a próxima sessão recupera o estado lendo docs, não relendo conversa.
- **Ao delegar, prompt com ponteiros, não com colagem:** a tarefa vai com referências (spec, docs relevantes) para o agente ler o que precisar — não com o conteúdo inteiro dos docs colado no prompt.

## 8. Autonomia e pontos de parada

Entre o briefing e o merge, o fluxo opera sozinho — inclusive o ciclo implementa→testa→corrige (workflow `implement-feature`, teto de 3 voltas). Agente não para para pedir permissão nem para mostrar progresso; para quando falta uma decisão que só o dono do projeto pode tomar:

1. **Produto/escopo:** requisito ambíguo, escopo novo, trade-off visível ao usuário final.
2. **Spec de alto impacto:** arquitetura nova, área sensível ou escopo grande — a implementação espera o OK da spec (§1.1).
3. **Arquitetura:** decisão com impacto duradouro → ADR antes de implementar.
4. **Comportamento em refactor:** um passo exigiria mudar comportamento observável.
5. **Loop que não converge:** suite ainda vermelha após o teto de voltas, ou correção que exigiria enfraquecer/apagar teste.
6. **Merge:** OK final do dono do projeto. Não há autorização de merge automático registrada — esta parada sempre existe.

Fora desses pontos, a regra é seguir e reportar no fim — não perguntar "posso?".
