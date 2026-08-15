---
name: feature
description: Fluxo padrão de desenvolvimento de uma feature de {{PROJETO}}, do spec ao merge, com testes, review dos agentes e documentação obrigatória. Use quando o usuário pedir para implementar uma feature nova ou continuar uma FEAT existente.
---

# /feature — fluxo padrão de feature

Siga as etapas na ordem. Nenhuma etapa é opcional; o Definition of Done está em docs/process/DEVELOPMENT_PROCESS.md §2.

## 1. Identificar
- Se `$ARGUMENTS` referencia uma FEAT existente, abra a spec em docs/features/ e continue de onde parou.
- Se é feature nova: determine o próximo ID `FEAT-NNN` (maior existente + 1), confirme com o usuário o escopo em 2–3 frases antes de seguir.

## 2. Spec
- Crie `docs/features/FEAT-NNN-slug.md` a partir de `docs/features/_TEMPLATE.md` (use o agente **tech-writer**).
- Preencha: contexto, escopo, fora de escopo, impacto técnico, plano de testes, validação manual.
- Decisão de arquitetura nova → registre ADR via `/adr` antes de codar.
- Spec pronta → mostre um resumo ao usuário. Só siga para implementação com spec aprovada ou se o usuário já deu carta branca.

## 3. Branch
- `git checkout -b feature/FEAT-NNN-slug` a partir de `main` atualizada.

## 4. Implementar
- Delegue ao agente **backend-dev** (API/domínio/banco) e/ou **frontend-dev** (UI) conforme o impacto técnico da spec. Tarefas independentes rodam em paralelo.
- Em paralelo ou logo após, o agente **qa-engineer** cobre o plano de testes (unit, integração e o que mais o plano exigir).
- Rode a suite completa localmente. Vermelho → corrigir antes de seguir. Nunca pule esta etapa.

## 5. Review (obrigatório)
- Com a ferramenta Workflow disponível, rode o workflow salvo **`review-feature`** (`Workflow({name: 'review-feature', args: {base: 'main'}})`) — ele executa os passos abaixo: reviewers em paralelo e verificação adversarial de cada achado antes do reporte. Sem a ferramenta, siga manualmente:
- Agente **code-reviewer** revisa o diff completo (`git diff main...HEAD`).
- Se o diff toca autenticação, permissões, queries sobre dados sensíveis, upload ou secrets/env: agente **security-auditor** também.
  <!-- ADAPTE: acrescente aqui as áreas sensíveis do domínio deste projeto que também disparam o security-auditor (ex.: cálculo financeiro, isolamento entre clientes). -->
- Os reviewers rodam com Opus (frontmatter dos agentes). Nunca rode review em modelo menor que Opus e nunca pule o review por indisponibilidade de modelo.
- Corrija bloqueantes e importantes; re-rode os testes; sugestões viram issues.

## 6. Documentar a entrega
- Agente **tech-writer**: preenche a seção **Entrega** da spec (o que foi feito de fato, desvios, pendências com issue) e adiciona entrada no `CHANGELOG.md` em `[Não lançado]`.

## 7. Entregar
- Commits em Conventional Commits pt-BR (um commit por mudança lógica; squash dos wip).
- Push + PR no GitHub com o template preenchido. Reporte ao usuário: link do PR, resumo da entrega, resultado dos reviews e pendências.
- Merge (squash) só após OK do dono do projeto, com CI verde + reviews resolvidos. Decisão de produto/escopo nova sempre para no usuário.
  <!-- ADAPTE: o dono do projeto pode autorizar merge automático (autopilot) quando CI verde + reviews resolvidos; registre aqui a autorização e a data se for o caso. -->

## Checklist final (o mesmo do template de PR — confira antes do merge)
- [ ] Spec em `docs/features/` com seção **Entrega** preenchida
- [ ] Testes: unit + integração (e suites da área tocada) verdes, cobertura dentro do gate de `docs/TESTING.md`
- [ ] Review `code-reviewer` resolvido (+ `security-auditor` se tocou auth/permissões/dados sensíveis/upload/env)
- [ ] `CHANGELOG.md` atualizado em `[Não lançado]`
- [ ] Migrações reversíveis; TODOs com issue (`TODO(#42)`); sem secret em código
