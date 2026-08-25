# ADR-004 — Scheduler durável em tabela `jobs` (poll 30s, catch-up no boot)

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** RF-03, RF-04, PRD.md §5 (RNF Confiabilidade)

## Contexto

A tese central do produto é que o lembrete que não chega destrói a confiança de uma vez (PRD §1). A meta de confiabilidade é dura: ≥ 99,5% de entrega, zero jobs perdidos em restart ou deploy. Isso descarta qualquer mecanismo de agendamento que viva só em memória de processo — um `setTimeout` ou um cron em memória perde todo o estado agendado no instante em que o processo reinicia, seja por deploy, crash ou atualização da imagem.

O produto também depende de proatividade constante (briefings, revisões, cadeias de lembrete, cobranças) — se o "coração" que dispara essas ações não sobreviver a um restart, todo o resto da confiabilidade descrita no PRD vira teatro.

## Decisão

Todo comportamento proativo do sistema é uma linha na tabela `jobs` do SQLite, nunca um timer em memória. Cada job tem `next_run_at` (America/Sao_Paulo), `recorrencia`, `status` (`pending|running|sent|confirmed|failed`) e `attempts`.

O `core/scheduler/` faz polling a cada 30 segundos, selecionando jobs vencidos (`next_run_at <= agora`) — o que inclui, no boot, qualquer job que tenha vencido durante o tempo em que o processo esteve fora do ar (catch-up). Job só é marcado `confirmed` após resposta 2xx da Evolution API; falha de envio aciona retry exponencial; retries esgotados disparam alerta por e-mail, nunca falha silenciosa. Recorrência gera a próxima ocorrência no momento do disparo, não antecipadamente.

Cron em memória é proibido em qualquer módulo — regra listada explicitamente em ARCHITECTURE.md §3 como ponto que "alguém vai querer simplificar no futuro" e não deve.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| `setTimeout`/`setInterval` em memória por job | Simples de implementar, zero schema extra | Todo agendamento se perde em restart/crash/deploy; sem catch-up possível | Viola diretamente a meta de zero jobs perdidos em restart |
| Fila externa (BullMQ/Redis, cron do SO) | Ferramentas maduras de agendamento distribuído | Mais um serviço para operar; over-engineering para volume de um único usuário; PRD proíbe filas/microserviços como não-objetivo | Complexidade desnecessária para a escala real; SQLite já resolve com poll simples |
| Tabela `jobs` no SQLite com poll periódico e catch-up no boot | Sobrevive a qualquer restart; auditável (histórico de jobs fica no banco); testável (catch-up é cenário de teste explícito) | Poll de 30s introduz latência de até 30s no disparo (aceitável frente à meta de ±2 min); polling constante é leve mas não é "reativo" | — (escolhida) |

## Consequências

- Positivas: nenhum job se perde em deploy ou crash — o catch-up no boot é comportamento testado, não best-effort; toda proatividade do sistema tem trilha auditável (job → outbox → 2xx → `delivered_at`), que é exatamente a base do cálculo da métrica de 99,5% do PRD; adicionar um novo tipo de job (novo módulo) não exige tocar no scheduler, só registrar um `JobHandler` no manifesto.
- Negativas: poll de 30s é overhead constante de I/O no SQLite, mesmo quando não há nada vencido — aceitável na escala de um usuário, mas não escalaria para multi-tenant sem repensar (não-objetivo da v1); latência mínima de disparo é o intervalo de poll, não instantânea.
- Reversibilidade: média. Trocar o mecanismo de disparo (por exemplo, para um scheduler orientado a eventos) exigiria reescrever `core/scheduler/`, mas o contrato da tabela `jobs` como fonte da verdade permaneceria — os handlers dos módulos não precisariam mudar.
