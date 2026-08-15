---
name: release
description: Prepara uma release de {{PROJETO}} — fecha o CHANGELOG, cria tag SemVer e gera release notes. Use quando o usuário pedir para lançar/liberar uma versão.
---

# /release — fluxo de release

## 1. Pré-condições (aborte se falhar)
- Branch `main` atualizada, working tree limpa, CI do último commit verde.
- `CHANGELOG.md` tem conteúdo em `[Não lançado]` — se vazio, não há o que lançar.

## 2. Versão
- SemVer a partir do conteúdo: só `Corrigido` → patch; `Adicionado`/`Alterado` → minor; quebra de compatibilidade → major (confirme com o usuário).
- Antes do launch usamos `v0.x.y` — minor para features, patch para fixes.

## 3. Fechar o CHANGELOG
- Renomeie `[Não lançado]` para `[vX.Y.Z] - AAAA-MM-DD` e crie nova seção `[Não lançado]` vazia.
- Revise as entradas: linguagem de usuário/operador, sem jargão de diff, agrupadas em Adicionado / Alterado / Corrigido / Segurança.

## 4. Tag e release
- Commit `chore(release): vX.Y.Z`; tag anotada `vX.Y.Z` com resumo.
- `gh release create` com release notes: destaques (3–5 bullets), mudanças completas (do CHANGELOG), migrações/ações manuais necessárias (se houver, em destaque no topo).

## 5. Pós-release
- Confirme que o pipeline de produção disparou (tag → deploy, ver [docs/TESTING.md](../../../docs/TESTING.md)) e acompanhe o smoke test.
  <!-- ADAPTE: se o deploy deste projeto não é disparado por tag, descreva aqui o gatilho real do pipeline de produção. -->
- Reporte ao usuário: versão, link da release, o que foi lançado e o resultado do smoke.
