# ADR-006 — Caminho crítico determinístico, LLM opcional

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** RF-03, RF-05, RF-06, PRD.md §1 (tese 2)

## Contexto

A segunda tese inegociável do PRD é que o caminho crítico de confiabilidade não pode depender de um serviço externo cuja disponibilidade o produto não controla. A API do Claude pode cair, ficar lenta ou retornar erro — e nada disso pode significar "o lembrete não chegou" ou "o briefing não chegou". Ao mesmo tempo, o produto quer que briefings, revisões e conversas tenham qualidade de redação natural e variada, o que só um LLM entrega bem.

Esses dois objetivos parecem em tensão, mas não são: a solução é separar estritamente o que precisa ser confiável (disparo, dados, horário) do que precisa ser bem redigido (o texto final da mensagem).

## Decisão

O caminho crítico — disparo de lembretes pontuais e de cadeia — é **100% determinístico**: templates de texto fixos (com variação pré-escrita, não gerada), sem nenhuma chamada de LLM entre o job vencer e a mensagem sair (ver sequência em ARCHITECTURE.md §4.2).

Para briefing e revisão noturna, que se beneficiam de redação natural, o padrão é: **código coleta os dados** (agenda, prioridades, itens vencidos) e **o Sonnet só redige** o texto final a partir desses dados. Se a chamada ao Claude falhar ou expirar (timeout), um template determinístico monta a mesma informação sem o LLM — o briefing e a revisão nunca deixam de chegar, só perdem variedade de redação nesse dia.

O LLM nunca decide *se* uma mensagem proativa sai ou *quando* — isso é sempre função do scheduler e do task-store. O LLM decide, no máximo, *como* a mensagem é redigida.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Todo texto proativo gerado pelo Sonnet, sem fallback | Redação sempre natural e variada, mesmo em lembretes pontuais | Uma queda ou lentidão da API do Claude vira lembrete perdido ou briefing atrasado — exatamente o cenário que o PRD trata como falha inaceitável | Acopla a confiabilidade do produto à disponibilidade de um serviço terceiro fora do controle do time |
| Caminho crítico 100% template, sem LLM em nenhum ritual | Máxima confiabilidade, zero dependência externa em qualquer mensagem proativa | Briefing e revisão ficariam com texto sempre idêntico, sem a naturalidade que o produto busca no tom de "colega adulto" | Sacrifica qualidade de produto sem necessidade — dá para ter os dois com separação código/redação |
| Lembretes pontuais 100% template; briefing/revisão com Sonnet redigindo sobre dados coletados por código, e fallback template se falhar | Confiabilidade total no caminho mais crítico (lembretes); qualidade de redação nos rituais, sem abrir mão de confiabilidade neles também | Exige manter dois caminhos (redação por LLM e fallback template) sincronizados nos mesmos dados | — (escolhida) |

## Consequências

- Positivas: uma queda total da API do Claude degrada apenas a "conversa livre" do produto — lembretes, cadeias, briefing e revisão continuam chegando, só com texto menos variado; o teste de falha injetada (TESTING.md) pode simular a API fora do ar e verificar que o valor diário do produto sobrevive; a separação dados/redação também facilita testar a lógica de negócio sem depender de mock de LLM.
- Negativas: dois caminhos de geração de texto (Sonnet e template) precisam ser mantidos consistentes nos mesmos dados — mudar o conteúdo do briefing exige atualizar os dois; o fallback template é necessariamente menos natural, então dias de degradação têm uma experiência perceptivelmente mais "robótica".
- Reversibilidade: alta — cada ritual decide independentemente se usa fallback; adicionar fallback a um ritual novo é aditivo, não exige tocar nos existentes.
