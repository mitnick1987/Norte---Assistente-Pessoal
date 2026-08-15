---
name: handoff
description: Gera/atualiza o documento de handoff de {{PROJETO}} — fotografia fiel do estado do projeto para outro dev assumir. Use no fim de cada milestone, antes de pausas longas ou quando o usuário pedir.
---

# /handoff — documento de passagem de bastão

Gere `docs/HANDOFF.md` a partir do estado REAL do repositório (código, issues, PRs, CI) — não do que os docs dizem que deveria existir. Se necessário, use o agente tech-writer (e o subagente nativo Explore do Claude Code para varrer o repositório).

## Estrutura obrigatória

1. **Estado em uma frase** — ex.: "M2 concluído; M3 40%, bloqueado em X".
2. **O que está pronto e funcionando** — por milestone/FEAT, com link para as specs (seção Entrega).
3. **Em andamento** — branches abertas, PRs pendentes, o que falta em cada um (concreto: arquivo/teste/decisão).
4. **Decisões pendentes** — o que está esperando resposta do dono do produto, com contexto para decidir.
5. **Como rodar** — setup local do zero (comandos exatos), rodar testes, acessar staging. Valide os comandos antes de escrever.
6. **Mapa do código** — 1 linha por módulo/pacote apontando os docs (não duplique ARCHITECTURE.md, aponte para ele).
7. **Débitos e armadilhas** — TODOs com issue, gambiarras conscientes, partes frágeis, o que NÃO mexer sem ler a ADR tal.
8. **Acessos e secrets** — ONDE estão (gerenciador de secrets do CI e da infra), nunca os valores.

## Regras
- Divergência entre doc e realidade encontrada durante a varredura → corrija o doc na hora e liste no handoff.
- Data e commit hash no topo do documento.
- Termine mostrando o resumo ao usuário com o que mudou desde o último handoff.
