---
name: release
description: Prepara uma release de Norte — fecha o CHANGELOG, cria tag SemVer e gera release notes. Use quando o usuário pedir para lançar/liberar uma versão.
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
- O gatilho do pipeline de produção é a tag SemVer: `vX.Y.Z` publicada dispara o deploy via `docker compose pull && docker compose up -d` no VPS (ver [docs/TESTING.md](../../../docs/TESTING.md)). Confirme que o pipeline disparou e acompanhe o smoke test.
- Checklist de pós-release inclui **teste de restauração do backup Litestream** (restore a partir do Backblaze B2) — backup que nunca foi restaurado não é backup.
- **Smoke falhou → rollback imediato:** re-deploy da tag anterior; migração já aplicada reverte pelo `down` (migração reversível é gate do DoD — é aqui que ela paga a conta). Registre o incidente como `BUG-NNN` com causa raiz antes de tentar de novo.
- Reporte ao usuário: versão, link da release, o que foi lançado e o resultado do smoke.
