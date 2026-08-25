---
name: refactor
description: Fluxo padrão de refactor de Norte — mudança estrutural que preserva comportamento, protegida por testes de caracterização. Use quando o usuário pedir para reestruturar, simplificar ou modernizar código existente sem mudar o que ele faz.
---

# /refactor — fluxo padrão de refactor

Refactor muda estrutura, nunca comportamento. Mudança de comportamento descoberta ou desejada no meio do caminho vira `FEAT-NNN` ou `BUG-NNN` separada — nunca entra no mesmo PR.

## 1. Registrar e delimitar
- Determine o próximo ID `REF-NNN`; crie a issue com label `refactor`: motivação (dor concreta — lentidão para evoluir, duplicação, acoplamento — não "deixar mais bonito"), área afetada e resultado estrutural esperado.
- Crie `docs/features/REF-NNN-slug.md` a partir do `_TEMPLATE.md`: contexto, escopo, **fora de escopo (o que NÃO muda, incluindo comportamento observável)**, impacto técnico.
- Mudança de fronteira de módulo, padrão arquitetural ou tecnologia → ADR via `/adr` antes de codar.
- Refactor grande (semanas) → quebre em PRs incrementais em que o código novo convive com o antigo (strangler fig); cada PR deixa a suite verde e o sistema deployável.

## 2. Rede de proteção ANTES de mexer
- Agente **qa-engineer** avalia a cobertura da área. Cobertura fraca → escreva **testes de caracterização** primeiro: eles fixam o comportamento ATUAL, inclusive o estranho.
- Comportamento errado descoberto na caracterização é registrado como `BUG-NNN` — não se aproveita o refactor para corrigir em silêncio.
- Baseline: suite completa verde em `main` antes do primeiro commit. Anote as métricas que o refactor promete melhorar (cobertura, duplicação, tempo de build, latência) para comparar no fim.

## 3. Refatorar em passos pequenos
- Branch `refactor/REF-NNN-slug` a partir de `main` atualizada.
- Delegue ao **backend-dev** e/ou **frontend-dev**. Cada commit: compila, suite verde, um movimento estrutural (`refactor(escopo): ...`).
- Commit que altera teste E código de produção ao mesmo tempo merece desconfiança: teste de caracterização só muda se uma interface pública mudou de propósito — e isso está na spec.
- Um passo exigiu mudar comportamento → pare, registre a pendência na spec e discuta com o usuário antes de seguir.

## 4. Review (obrigatório)
- Igual ao `/feature` §5: workflow salvo **`review-feature`** quando a ferramenta Workflow estiver disponível (`Workflow({name: 'review-feature', args: {base: 'main'}})`); senão, **code-reviewer** no diff completo e **security-auditor** se tocar área sensível.
- Pauta extra deste review: há mudança de comportamento escondida no diff? Alguma interface pública mudou sem estar na spec?

## 5. Registrar e entregar
- Releia a spec e o Definition of Done antes do commit final — em sessão longa, o que foi lido no início é o que mais se perde.
- Seção **Entrega** da spec (agente **tech-writer**): o que mudou estruturalmente, métricas antes/depois, o que ficou para o próximo REF.
- `docs/ARCHITECTURE.md` atualizado se fronteiras ou módulos mudaram.
- CHANGELOG em `[Não lançado]` → `Alterado` só se algo visível a quem usa/opera mudou; senão, nada — changelog não é log de commits.
- PR, CI verde, merge com OK do dono do projeto — igual a toda entrega.

## Checklist final
- [ ] Nenhum teste de caracterização alterado sem justificativa na spec
- [ ] Suite completa verde; cobertura da área ≥ baseline registrado no passo 2
- [ ] Nenhuma mudança de comportamento no diff (as descobertas viraram FEAT/BUG separadas)
- [ ] ARCHITECTURE.md e ADRs refletem a estrutura nova
- [ ] Spec REF com seção Entrega e métricas antes/depois
