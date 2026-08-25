# ADR-003 — SQLite WAL como única persistência do brain

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** PRD.md §5 (RNF Manutenibilidade), ARCHITECTURE.md §3

## Contexto

O Norte é single-user: uma persona, um número autorizado, sem multi-tenancy (ARCHITECTURE.md §3.1). O RNF de manutenibilidade do PRD é explícito — "mantível por uma pessoa daqui a 2 anos" — e lista "uma persistência" como critério de toda decisão de arquitetura. Não há necessidade de concorrência de escrita alta (um usuário só gera um volume de escrita irrisório para qualquer banco relacional moderno) nem de separação entre serviços que justifique um banco compartilhado.

A Evolution API já roda com Postgres e Redis próprios no compose — dependências internas dela, isoladas do brain. Introduzir mais um banco (Postgres para o brain, ou Redis para cache/filas) multiplicaria a superfície operacional sem benefício funcional: mais um serviço para monitorar, fazer backup e manter compatível em upgrades.

## Decisão

SQLite em modo WAL (via `better-sqlite3`) é a única persistência do `brain`. Toda entidade do domínio — items, reminders, events, jobs, messages, facts, patterns, settings, auth_tokens — vive no mesmo arquivo. Backup contínuo via Litestream, replicando para Backblaze B2 (ARCHITECTURE.md §1).

O Postgres e o Redis do compose pertencem exclusivamente à Evolution API; o brain nunca os acessa.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Postgres dedicado para o brain | Concorrência de escrita mais alta, ecossistema de ferramentas maior | Mais um serviço para operar (container, backup, upgrade, credenciais) sem ganho real para single-user | Custo operacional sem benefício funcional — viola o RNF de manutenibilidade |
| SQLite WAL, arquivo único | Zero operação extra (sem servidor de banco), backup simples (arquivo), suficiente para a carga de um usuário | Concorrência de escrita limitada (um writer por vez); sem replicação nativa multi-nó | — (escolhida) |
| Redis para filas/cache + SQLite para dados | Filas mais robustas para jobs de alto volume | O volume de jobs do Norte (lembretes de um usuário) não justifica infraestrutura de fila; PRD proíbe explicitamente filas/microserviços como over-engineering (§1, não-objetivos) | Complexidade desnecessária para a escala real do produto |

## Consequências

- Positivas: zero operação de banco separado (sem credenciais extras, sem container extra para o brain); backup e restore são um arquivo replicado continuamente pelo Litestream; leitura é rápida o bastante para não precisar de cache dedicado.
- Negativas: SQLite serializa escritas — um único writer por vez, mesmo em modo WAL, que permite leitores concorrentes mas não escrita paralela. Para um único usuário isso nunca é gargalo real, mas é uma limitação estrutural que não escala para multi-tenant sem repensar a persistência (não-objetivo explícito da v1). Migrações de schema em SQLite são mais manuais que em Postgres (sem ferramentas de migração tão maduras).
- Reversibilidade: baixa a médio prazo — migrar para Postgres exigiria reescrever a camada `core/db/` e todos os módulos que fazem SQL direto (nenhum deveria, ver regra de módulos em ARCHITECTURE §2, mas a superfície de queries ainda precisaria ser portada). Aceitável porque a decisão de permanecer single-user é, ela mesma, um não-objetivo estável do produto.
