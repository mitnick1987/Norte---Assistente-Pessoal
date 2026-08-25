---
name: feature
description: Fluxo padrão de desenvolvimento de uma feature de Norte, do spec ao merge, com testes, review dos agentes e documentação obrigatória. Use quando o usuário pedir para implementar uma feature nova ou continuar uma FEAT existente.
---

# /feature — fluxo padrão de feature

Siga as etapas na ordem. Nenhuma etapa é opcional; o Definition of Done está em docs/process/DEVELOPMENT_PROCESS.md §2. Entre as etapas, não pare para pedir permissão — os pontos legítimos de parada estão no DEVELOPMENT_PROCESS.md §8.

## 1. Identificar
- Se `$ARGUMENTS` referencia uma FEAT existente, abra a spec em docs/features/ e continue de onde parou.
- Se é feature nova: determine o próximo ID `FEAT-NNN` (maior existente + 1), confirme com o usuário o escopo em 2–3 frases antes de seguir.

## 2. Spec
- Crie `docs/features/FEAT-NNN-slug.md` a partir de `docs/features/_TEMPLATE.md` (use o agente **tech-writer**).
- Preencha: contexto, escopo, fora de escopo, impacto técnico, plano de testes, validação manual.
- Decisão de arquitetura nova → registre ADR via `/adr` antes de codar.
- Spec pronta → mostre o resumo ao usuário e siga direto para a implementação. Espere o OK explícito apenas quando: restou pergunta de produto/escopo que a spec não resolve, ou a spec é de alto impacto — ADR, área sensível (gatilhos do security-auditor) ou escopo grande (DEVELOPMENT_PROCESS.md §1.1). Fora disso, o usuário interrompe se discordar do resumo.

## 3. Branch
- `git checkout -b feature/FEAT-NNN-slug` a partir de `main` atualizada.

## 4. Implementar
- Com a ferramenta Workflow disponível, rode o workflow salvo **`implement-feature`** (`Workflow({name: 'implement-feature', args: {spec: 'docs/features/FEAT-NNN-slug.md', areas: ['backend', 'frontend']}})`) — ele implementa, cobre o plano de testes e itera implementa→testa→corrige até a suite ficar verde (teto de 3 voltas), escalando só quando falta decisão humana. Sem a ferramenta, siga manualmente:
- Delegue ao agente **backend-dev** (API/domínio/banco) e/ou **frontend-dev** (UI) conforme o impacto técnico da spec. Tarefas independentes rodam em paralelo.
- Em paralelo ou logo após, o agente **qa-engineer** cobre o plano de testes (unit, integração e o que mais o plano exigir).
- Rode a suite completa localmente. Vermelho → devolva as falhas ao implementador da área e repita até verde (máx. 3 voltas; depois disso, pare e reporte). Proibido enfraquecer teste para passar. Nunca pule esta etapa.

## 5. Review (obrigatório)
- Com a ferramenta Workflow disponível, rode o workflow salvo **`review-feature`** (`Workflow({name: 'review-feature', args: {base: 'main'}})`) — ele executa os passos abaixo: reviewers em paralelo e verificação adversarial de cada achado antes do reporte. Sem a ferramenta, siga manualmente:
- Agente **code-reviewer** revisa o diff completo (`git diff main...HEAD`).
- Se o diff toca autenticação, permissões, queries sobre dados sensíveis, upload ou secrets/env: agente **security-auditor** também.
- Também disparam o security-auditor: webhook da Evolution/borda HTTP, autenticação e filtro de JID do dono, tokens OAuth e cifra (`auth_tokens`), escopos Google, envio de mensagens/outbox (política anti-banimento), manuseio de mídia (`getBase64FromMediaMessage`), e o system prompt de tom (RF-14 — mudanças no tom passam por review com a suite de regressão).
- Os reviewers rodam com Opus (frontmatter dos agentes). Nunca rode review em modelo menor que Opus e nunca pule o review por indisponibilidade de modelo.
- Corrija bloqueantes e importantes; re-rode os testes; sugestões viram issues.

## 6. Documentar a entrega
- Agente **tech-writer**: preenche a seção **Entrega** da spec (o que foi feito de fato, desvios, pendências com issue) e adiciona entrada no `CHANGELOG.md` em `[Não lançado]`.

## 7. Entregar
- Releia a spec e o Definition of Done antes do commit final — em sessão longa, o que foi lido no início é o que mais se perde.
- Commits em Conventional Commits pt-BR (um commit por mudança lógica; squash dos wip).
- Push + PR no GitHub com o template preenchido (incl. a seção **Onde olhar primeiro**). Reporte ao usuário: link do PR, resumo da entrega, resultado dos reviews, pendências e **onde olhar em 5 minutos** — os 2–3 pontos do diff que mais merecem olhar humano (a decisão mais arriscada, o trecho mais sensível, o desvio da spec).
- Merge (squash) só após OK do dono do projeto, com CI verde + reviews resolvidos. Decisão de produto/escopo nova sempre para no usuário. Não há autorização de merge automático registrada.

## Checklist final (o mesmo do template de PR — confira antes do merge)
- [ ] Spec em `docs/features/` com seção **Entrega** preenchida
- [ ] Testes: unit + integração (e suites da área tocada) verdes, cobertura dentro do gate de `docs/TESTING.md`
- [ ] Review `code-reviewer` resolvido (+ `security-auditor` se tocou auth/permissões/dados sensíveis/upload/env)
- [ ] `CHANGELOG.md` atualizado em `[Não lançado]`
- [ ] Migrações reversíveis; TODOs com issue (`TODO(#42)`); sem secret em código
