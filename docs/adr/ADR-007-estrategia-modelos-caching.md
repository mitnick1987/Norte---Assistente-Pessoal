# ADR-007 — Haiku 4.5 triagem + Sonnet 5 conversa, prompt byte-estável, Batch API noturna

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** RF-07, RF-15, RF-19, PRD.md §5 (RNF Custo), §9 (riscos)

## Contexto

O PRD define um teto de custo duro: ≤ US$32/mês total, com o orçamento já calculado no **preço cheio** do Sonnet 5 — o preço introdutório termina em 31/08/2026 e a decisão foi tomada para não depender dele. O risco mais citado no PRD para descontrole de custo é a invalidação silenciosa de prompt cache, que pode multiplicar o custo por 5–10x sem nenhum sintoma visível além da fatura.

Ao mesmo tempo, o produto tem operações de naturezas muito diferentes: classificar uma mensagem em tarefa/ideia/compromisso é um julgamento simples e de alto volume; conversar, priorizar e redigir briefing exige mais raciocínio; consolidar fatos de um dia inteiro de conversa é um trabalho noturno sem restrição de latência. Usar o mesmo modelo para as três coisas seria pagar o preço do raciocínio caro em tarefas que não precisam dele.

## Decisão

Três modelos, três papéis, nenhum Opus:

- **Haiku 4.5 na triagem** — classificação de mensagem recebida (captura | comando | conversa | agenda), extração estruturada de itens e execução do executor determinístico (RF-07). Meta explícita: ≥ 40–50% dos turnos diários resolvidos sem tocar o Sonnet.
- **Sonnet 5 na conversa** — redação de briefing/revisão, priorização, formulação de planos e micropassos, qualquer interação que exija julgamento mais rico. Roda sempre com **prompt caching byte-estável**: o system prompt é montado pelos fragmentos dos módulos em ordem determinística e permanece idêntico byte a byte durante o dia; a data corrente entra só na última mensagem do usuário, nunca no system prompt.
- **Batch API (50% off) na consolidação noturna** — job que destila a conversa do dia em `facts` (RF-19) roda em lote, sem restrição de latência, com desconto de preço.

O orçamento é calculado no preço cheio do Sonnet 5 pós-31/08/2026, não no preço introdutório. Teto de US$32/mês com alerta em US$25 (RF-15) e alarme dedicado quando `cache_read_input_tokens = 0` em chamadas repetidas — sinal direto de que o cache parou de funcionar, silenciosamente.

Opus não entra na v1 nem no roadmap conhecido: nenhuma tarefa do produto (classificação, conversa, consolidação) justifica o custo do modelo mais caro da família.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Sonnet para tudo (triagem, conversa, consolidação) | Um único modelo, código mais simples | Custo de triagem em alto volume com modelo caro; sem redução de custo na consolidação noturna | Estoura o teto de US$32/mês facilmente na escala de triagem diária |
| Haiku para tudo, incluindo conversa | Custo mínimo | Qualidade de raciocínio insuficiente para priorização, formulação de plano e tom RSD-safe consistente — risco direto à tese de adesão de longo prazo | Sacrifica qualidade de produto no ponto que mais importa para retenção |
| Incluir Opus na retrospectiva mensal ou em decisões complexas | Raciocínio mais forte pontualmente | Custo desproporcional para uma tarefa mensal e descritiva; PRD proíbe explicitamente (não-objetivo: "retrospectiva semanal com Opus" nem existe — só mensal, com Sonnet) | Não há tarefa no roadmap que justifique o custo extra |
| Haiku triagem + Sonnet conversa com cache byte-estável + Batch API noturna, sem Opus | Custo proporcional à complexidade real de cada tarefa; cache reduz o custo do Sonnet no maior volume de tokens (system prompt); Batch API corta 50% do custo de um job sem restrição de latência | Exige disciplina de manter o system prompt byte-estável (qualquer mudança de ordem de fragmento invalida o cache); orçamento calculado no cenário mais caro, sem margem do preço introdutório | — (escolhida) |

## Consequências

- Positivas: custo proporcional ao valor de cada operação; a meta de ≥ 40% dos turnos sem Sonnet (RF-07) é diretamente mensurável no log de custo; o alarme de `cache_read=0` transforma um risco historicamente silencioso (regressão de cache) em falha visível com alerta por e-mail; orçar no preço cheio evita surpresa quando o preço introdutório acabar.
- Negativas: manter o system prompt byte-estável é uma restrição de engenharia permanente — qualquer módulo novo que contribua um `promptFragment` precisa respeitar ordem determinística (ARCHITECTURE.md §2), e um bug aqui custa caro e é fácil de não perceber sem o alarme dedicado; usar três modelos diferentes multiplica os cenários de teste de custo e de qualidade de resposta; sem Opus, alguma tarefa futura que realmente precise de raciocínio de ponta (se surgir) exigiria reabrir esta decisão.
- Reversibilidade: média — trocar o modelo de um papel específico (por exemplo, Haiku por outro modelo de triagem) é isolado no `core/llm/`; abandonar o prompt caching byte-estável exigiria reabrir o orçamento de custo inteiro, já que ele é premissa do teto de US$32/mês.
