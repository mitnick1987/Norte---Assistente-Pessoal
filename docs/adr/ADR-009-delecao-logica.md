# ADR-009 — Deleção sempre lógica em todas as entidades

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** RF-11, ARCHITECTURE.md §3

## Contexto

Duas forças do produto convergem para a mesma exigência técnica. Primeiro, a tese de design para TDAH: "dropar sem culpa" precisa ser reversível para ser seguro — se dropar uma tarefa fosse uma decisão irreversível, o usuário hesitaria em usar a função exatamente no momento em que mais precisa dela (sobrecarga, paralisia). Segundo, a higiene automática da lista (RF-11) propõe arquivar/dropar itens parados como manutenção de rotina, não como fracasso — e uma proposta de manutenção rotineira não pode ter o peso de uma exclusão permanente de dado.

Existe ainda uma terceira força, de auditoria: o sistema precisa poder reconstruir o que aconteceu com um item ao longo do tempo (para depurar, para calcular métricas, para eventualmente explicar ao usuário "isso tinha sido dropado dia X").

## Decisão

Nenhuma entidade do domínio (`items`, `reminders`, `events`) é fisicamente apagada (`DELETE`) por ação do usuário ou do sistema. "Apagar" sempre significa mudar o `status` para um estado lógico terminal (`dropada`, `arquivada`) que:

- some da visão ativa do usuário (briefing, "qual a próxima", listas),
- continua existindo na tabela, podendo ser reativado,
- é auditável para métricas e depuração.

Essa regra está listada em ARCHITECTURE.md §3 explicitamente como ponto que alguém vai querer "simplificar" no futuro trocando por `DELETE` — e não deve.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| `DELETE` físico ao dropar/arquivar | Schema mais simples, tabelas menores | Irreversível — quebra a garantia de "dropar sem culpa" (usuário não confia numa ação que não pode desfazer); perde trilha de auditoria | Contradiz diretamente uma tese de design do produto, não só uma preferência técnica |
| Soft delete só em `items`, `DELETE` físico no resto | Meio-termo, menos disciplina exigida | Inconsistente — `reminders` e `events` também precisam de reversibilidade e auditoria (ex.: entender por que um lembrete não disparou) | Cria exceção sem justificativa forte o bastante |
| Deleção sempre lógica em todas as entidades | Reversível por design, sustenta "dropar sem culpa"; auditoria completa disponível para métricas e depuração | Tabelas crescem indefinidamente (nunca encolhem); toda query de listagem precisa lembrar de filtrar por status ativo | — (escolhida) |

## Consequências

- Positivas: dropar e arquivar são ações de baixo risco percebido para o usuário (consistente com o tom RSD-safe do produto); qualquer bug de "sumiu o item" é investigável olhando o histórico de status, nunca é uma perda de dado real; a métrica de higiene da lista (RF-11) e qualquer análise futura de padrões de uso têm dado completo disponível.
- Negativas: as tabelas nunca encolhem — crescimento é só aditivo, o que num sistema single-user de longuíssimo prazo (anos) exige atenção eventual a tamanho de arquivo e índice, ainda que SQLite lide bem com isso na escala de um usuário; toda query de leitura precisa disciplinadamente filtrar por status ativo (esquecer o filtro é bug silencioso: item "dropado" reaparecendo).
- Reversibilidade: a decisão em si é barata de manter; reverter para `DELETE` físico romperia a garantia de reversibilidade que o produto promete ao usuário — mudança que exigiria também mudar a proposta de valor do "dropar sem culpa", não só o código.
