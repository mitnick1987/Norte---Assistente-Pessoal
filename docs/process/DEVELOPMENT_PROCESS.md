# Processo de Desenvolvimento — {{PROJETO}}

**Versão:** 1.0 · **Data:** {{DATA}}

Processo padrão para toda mudança no código. O objetivo é que **qualquer dev que pegue o projeto amanhã** entenda o que foi feito, por quê, e consiga continuar sem perguntar nada a ninguém.

---

## 1. Fluxo de uma feature

```
Backlog → Spec → Branch → Implementação (TDD) → Review → Merge → Changelog
```

1. **Backlog:** toda feature nasce como issue no GitHub com o label `feature` e recebe um ID `FEAT-NNN` (sequencial). Bugs recebem `BUG-NNN`. Os templates em `.github/ISSUE_TEMPLATE/` já trazem os campos exigidos; issue em branco está desabilitada.
2. **Spec:** antes de codar, criar `docs/features/FEAT-NNN-slug.md` a partir do [_TEMPLATE.md](../features/_TEMPLATE.md). A spec diz **o que** será feito, **por quê**, escopo, fora de escopo, e como validar. Specs pequenas (1 página) são melhores que specs grandes.
3. **Branch:** a partir de `main`: `feature/FEAT-NNN-slug` ou `fix/BUG-NNN-slug`. `main` é protegida — nada de commit direto.
4. **Implementação:** teste primeiro sempre que possível (no mínimo: nenhuma lógica de negócio sem teste unitário; nenhuma rota crítica sem teste de integração — ver [TESTING.md](../TESTING.md)).
5. **Review (obrigatório, mesmo trabalhando solo):**
   - `code-reviewer` revisa o diff completo (qualidade, estilo, aderência à arquitetura);
   - `security-auditor` revisa **sempre que** o diff tocar em: auth, permissões, queries sobre dados sensíveis, upload, ou variáveis de ambiente/secrets;
     <!-- ADAPTE: acrescente aqui as áreas sensíveis específicas deste domínio (ex.: dinheiro, dados pessoais, isolamento entre clientes). -->
   - com a ferramenta Workflow do Claude Code disponível, a etapa roda pelo workflow salvo `review-feature` (`.claude/workflows/`): reviewers em paralelo e cada achado passa por verificação adversarial antes de ser reportado;
   - achados são corrigidos **antes** do merge.
6. **PR:** aberto no GitHub mesmo em solo — é o registro histórico. Descrição preenchida com o template (O que muda / Por quê / Como testar / Checklist). CI verde é gate.
7. **Merge:** squash merge com mensagem conventional, branch deletada. Gate = CI verde + reviews resolvidos + **OK do dono do projeto**.
   <!-- ADAPTE: o dono do projeto pode autorizar merge automático (sem aprovação manual) quando CI estiver verde e os reviews resolvidos — registre aqui essa autorização se for o caso. Decisões de produto novas continuam sendo dele. -->
8. **Pós-merge:** doc da feature atualizada com o estado final (seção "Entrega"), CHANGELOG atualizado.

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
- `feature/*`, `fix/*` — vida curta (dias, não semanas). Feature grande → quebrar em PRs menores atrás de flag.
- **Versionamento SemVer** (`v0.x.y` até o launch). Release = tag anotada + seção nova no CHANGELOG (skill `/release` faz isso).
- Deploy: merge em `main` → staging automático; tag → produção, conforme pipeline descrito no [TESTING.md](../TESTING.md).

## 5. Documentação por entrega (o que fica escrito, onde)

| Artefato | Onde | Quando |
|---|---|---|
| Spec + registro de entrega | `docs/features/FEAT-NNN-*.md` | Toda feature/bug relevante |
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

O fluxo completo é orquestrado pela skill **`/feature`** (e `/bugfix` para correções) — use-as em vez de improvisar o processo.
