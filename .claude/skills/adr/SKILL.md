---
name: adr
description: Registra uma decisão de arquitetura (ADR) de Norte. Use quando uma escolha técnica com impacto duradouro for tomada — ou quando o usuário pedir para registrar/revisar uma decisão.
---

# /adr — registro de decisão de arquitetura

## Quando uma decisão merece ADR
Escolha entre alternativas com impacto duradouro: tecnologia/lib estrutural, modelo de dados, padrão de segurança, contrato de API, estratégia de deploy. Regra prática: se daqui a 6 meses alguém perguntaria "por que fizeram assim?", é ADR.

## Passos
1. Determine o próximo número `ADR-NNNN` em docs/adr/.
2. Crie `docs/adr/NNNN-slug-da-decisao.md` a partir de `docs/adr/_TEMPLATE.md`.
3. Preencha com honestidade: contexto real, alternativas **de verdade consideradas** (com contras da opção escolhida também), consequências negativas e custo de reverter. ADR sem contras é propaganda, não registro.
4. Se a decisão substitui uma ADR anterior: marque a antiga como `substituída por ADR-NNNN` (não apague).
5. Adicione a linha na tabela de ADRs do docs/ARCHITECTURE.md e referencie a FEAT relacionada.
6. Mostre a ADR ao usuário para validação — a decisão é dele; o registro é nosso.
