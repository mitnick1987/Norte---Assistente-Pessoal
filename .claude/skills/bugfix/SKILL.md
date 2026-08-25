---
name: bugfix
description: Fluxo padrão de correção de bug de Norte — reproduzir com teste que falha, corrigir, registrar. Use quando o usuário reportar um bug ou pedir para corrigir um comportamento errado.
---

# /bugfix — fluxo padrão de correção

## 1. Registrar
- Determine o próximo ID `BUG-NNN`. Se não existe issue no GitHub, crie (`gh issue create`) com: comportamento esperado, comportamento observado, passos de reprodução.

## 2. Reproduzir ANTES de corrigir
- Escreva um teste que falha exatamente pelo bug (agente **qa-engineer**), no nível mais baixo possível (unit > integração > E2E).
- Não conseguiu reproduzir → investigue mais; não "corrija" o que não entende. Reporte ao usuário o que encontrou.

## 3. Corrigir
- Branch `fix/BUG-NNN-slug` a partir de `main`.
- Corrija a **causa raiz**, não o sintoma (agente **backend-dev** ou **frontend-dev**). Se a causa raiz for de arquitetura, pare e discuta com o usuário antes.
- O teste do passo 2 agora passa; a suite inteira continua verde. Vermelho → devolva as falhas ao implementador e repita até verde (máx. 3 voltas; depois disso, pare e reporte — não enfraqueça teste para passar).
- Pergunte-se: onde MAIS esse padrão de bug pode existir? Verifique e cubra.

## 4. Review
- Diff pequeno: **code-reviewer** direto. Tocou área sensível (auth, permissões, dados sensíveis, webhook da Evolution/borda HTTP, autenticação e filtro de JID do dono, tokens OAuth e cifra (`auth_tokens`), escopos Google, envio de mensagens/outbox, manuseio de mídia, variáveis de ambiente/secrets, ou o system prompt de tom): **security-auditor** também.
- Com a ferramenta Workflow disponível, o workflow salvo **`review-feature`** cobre esta etapa inteira (`Workflow({name: 'review-feature', args: {base: 'main'}})`): decide se o security-auditor entra, roda os reviewers em paralelo e verifica cada achado antes de reportar.

## 5. Registrar a correção
- `CHANGELOG.md` → `[Não lançado]` → seção `Corrigido`, em linguagem de quem usa o sistema.
- Se o bug revelou lacuna de processo/teste (ex.: faltava cenário numa suite obrigatória do docs/TESTING.md), corrija a lacuna no mesmo PR e anote no doc relevante.
- Bug em feature documentada → atualize a seção Entrega da FEAT com nota da correção.

## 6. Entregar
- Releia a issue e o Definition of Done antes do commit final — em sessão longa, o que foi lido no início é o que mais se perde.
- Commit `fix(escopo): descrição` com `Refs #NN`; PR; CI verde; reporte ao usuário com causa raiz explicada em 2–3 frases.
