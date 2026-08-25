# ADR-001 — Claude Messages API direta, não Agent SDK

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ARCHITECTURE.md §1, §4

## Contexto

O Norte é um daemon de webhooks 24/7: recebe eventos da Evolution API, decide o que fazer (classificar, responder, agendar) e escreve no task-store — sem sessão interativa de terminal, sem operador acompanhando. A integração com o Claude precisa de controle fino sobre três coisas que o PRD trata como requisito, não otimização: prompt caching byte-estável (RNF de custo, teto US$32/mês), persistência determinística do estado (o LLM nunca é o registro) e execução de tools validadas no backend antes de qualquer escrita.

A documentação oficial da Anthropic posiciona o Agent SDK como biblioteca para construir agentes de código — sessões que operam sobre arquivo, bash e ferramentas de desenvolvimento, tipicamente de vida curta e com um humano no loop. O Norte não se encaixa nesse perfil: é um processo de longa duração que atende requisições HTTP assíncronas, mantém seu próprio scheduler e precisa decidir exatamente quando cachear, quando truncar histórico e quando cair em fallback determinístico.

## Decisão

Integrar com o Claude via Messages API diretamente, com loop de tool use implementado à mão no módulo `core/llm/`.

O cliente do core é responsável por: montar o system prompt a partir dos fragmentos dos módulos em ordem estável (cache byte-estável), injetar a data apenas na última mensagem do usuário, executar o loop de tool calls contra as tools registradas pelos módulos (validação zod antes de qualquer escrita), and registrar `tokens_in`/`tokens_out`/`cache_read_tokens` por chamada na tabela `messages` para o monitor de custo.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Agent SDK | Loop de tool use pronto, menos código próprio | Desenhado para agentes de código (arquivo/bash/sessões), não para daemon de webhook; menos controle sobre a mecânica exata de caching e sobre quando persistir estado | Foco do produto é diferente do caso de uso do SDK; controle de caching é requisito, não deveria ficar atrás de abstração de terceiro |
| Messages API direta com tool use manual | Controle total de prompt caching, custo, formato de persistência e estratégia de fallback | Mais código de infraestrutura para manter (loop de tool use, parsing de blocks, retry) | — (escolhida) |

## Consequências

- Positivas: controle byte-a-byte do system prompt (essencial para o cache hit rate que sustenta o teto de custo); o loop de tool use pode ser interrompido/inspecionado em qualquer ponto para logging e para o monitor de custo; nenhuma dependência de abstração pensada para outro caso de uso.
- Negativas: o time mantém seu próprio código de loop de tool use, parsing de streaming (se vier a ser usado) e tratamento de erro de API — superfície que um SDK de alto nível abstrairia; qualquer melhoria futura do Agent SDK não chega automaticamente.
- Reversibilidade: média. Trocar por Agent SDK exigiria reescrever `core/llm/` e revalidar o comportamento de caching; a interface do cliente LLM já isola o resto do sistema dessa escolha, então o custo fica concentrado num módulo.
