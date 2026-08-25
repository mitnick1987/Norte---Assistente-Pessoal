# ADR-018 — Webhook com ACK imediato e processamento assíncrono com varredura de recuperação

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ARCHITECTURE.md §5, ADR-004, ADR-006, FEAT-002

## Contexto

Até a FEAT-001, o handler do webhook processava a mensagem inteira antes de responder — barato, porque nada fazia I/O externo. A FEAT-002 põe uma chamada real de LLM (triagem Haiku, timeout de até 15s) nesse caminho: manter a conexão HTTP da Evolution aberta por segundos viola o princípio do ARCHITECTURE.md §5 ("resposta rápida; processamento assíncrono via bus/jobs") e cria risco operacional — a Evolution pode estourar timeout e reentregar (o dedup segura a duplicata, mas o webhook passa a "falhar" aos olhos dela).

A tensão real é com o RF-01: a confirmação precisa chegar em ≤ 15s. O scheduler durável (poll de 30s) é lento demais para ser o transporte desse processamento; por isso "jogar na tabela `jobs`" puro não resolve.

## Decisão

1. O handler do webhook faz apenas o trabalho barato e determinístico: validação (zod + segredo + JID), dedup e **persistência da mensagem de entrada** com status de processamento `pending` — e responde 2xx imediatamente.
2. O processamento (triagem → captura → confirmação) roda **em background no mesmo processo**, disparado na hora (`setImmediate`/promise não aguardada com tratamento de erro e log) — preserva o ≤ 15s do RF-01.
3. **Varredura de recuperação no boot**: mensagens de entrada com processamento `pending` acima de um limiar de idade são reprocessadas na subida do processo (mesmo padrão do catch-up de jobs, ADR-004). Crash no meio do processamento não perde captura — a mensagem persistida é a fonte de recuperação.
4. Falha definitiva de processamento marca a mensagem como `failed` com log de erro; nunca silêncio.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Manter processamento síncrono no handler | Simples; era o padrão da FEAT-001 | Conexão aberta por segundos; timeout/reentrega da Evolution; viola §5 | O custo apareceu junto com o LLM — é exatamente o caso que o §5 previu |
| Tabela `jobs` como transporte do processamento | Durabilidade máxima, padrão único | Poll de 30s quebra o ≤ 15s do RF-01; jobs é para proatividade agendada, não para reação imediata | Latência incompatível com o requisito |
| Background em processo + varredura no boot | ACK imediato; ≤ 15s preservado; recuperação de crash pela mensagem persistida | Janela pequena de reprocessamento duplo após crash (mitigada por idempotência do dedup e da gravação de itens) | — (escolhida) |
| Fila externa (Redis/BullMQ) | Robustez de fila de verdade | Parte móvel nova que a ADR-003/RNF de manutenibilidade proíbem para single-user | Desproporcional |

## Consequências

- Positivas: webhook responde em milissegundos independentemente do LLM; reentregas da Evolution cessam de ser cenário normal; crash não perde mensagem; o padrão vale para todos os canais futuros (ADR-016).
- Negativas: o status de processamento vira coluna e máquina de estados a manter em `messages`; reprocessamento pós-crash pode gerar segunda confirmação ao usuário em caso raro (aceito — inócuo); testes de integração passam a esperar a conclusão do processamento em vez da resposta HTTP.
- Reversibilidade: média — voltar ao síncrono é trivial; trocar por fila externa no futuro é mudança contida no dispatcher.
