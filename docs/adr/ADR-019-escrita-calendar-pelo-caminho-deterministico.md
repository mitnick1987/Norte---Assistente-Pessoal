# ADR-019 — Escrita no Google Calendar pelo caminho determinístico da captura; tool para o brain fica na FEAT-006

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ADR-001, ADR-006, FEAT-005, FEAT-006, RF-12

## Contexto

A FEAT-005 pede que "marca dentista quinta 16h" crie o evento no Google Calendar. Havia duas leituras:

- **(A)** Estender o caminho de captura já existente: a triagem Haiku (determinística, FEAT-002/004) classifica `compromisso` com data resolvida pelo backend; o serviço de captura passa a criar também o evento remoto no Google e gravar o `gcal_id` no event interno. Zero LLM escolhendo tools em tempo real; reusa 100% do pipeline atual.
- **(B)** Expor uma `ToolDefinition create_event` que o modelo decide chamar — o que pressupõe um **loop de tool-use interativo do brain (Sonnet)** que ainda não existe em lugar nenhum do código.

O loop de tool-use do brain é o cerne da FEAT-006 (brain Sonnet, briefing, conversa). Construí-lo dentro da FEAT-005 explodiria o escopo ("a parte de backend da FEAT-005") e contrariaria a própria spec, que diz "nenhuma rota nova de uso diário".

## Decisão

1. Na FEAT-005, a escrita no Calendar acontece pelo **caminho determinístico** (opção A): captura de compromisso por frase/áudio → cria o evento no Google via o serviço do módulo `google-calendar` → grava `gcal_id` no event interno → gera a cadeia (FEAT-004). Nenhuma tool exposta a LLM, nenhum loop de decisão em tempo real.
2. A **tool `create_event` como `ToolDefinition` do registry** (que o brain escolhe chamar) fica para a **FEAT-006**, junto com o loop de tool-use do Sonnet. O registry de tools transport-agnostic (ADR-014) já está pronto para recebê-la — só falta o consumidor.
3. O `google-calendar-service` expõe `createRemoteEvent`/`listEvents` como contrato público do módulo, chamável tanto pelo caminho determinístico agora quanto pela tool do brain depois — a lógica de negócio não muda entre os dois consumidores.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| (A) Escrita pelo caminho determinístico da captura | Reusa o pipeline atual; escopo contido; alinhado a ADR-006 (crítico sem depender de decisão do LLM) | A criação por frase fica limitada ao que a triagem Haiku já extrai (sem negociação conversacional) | — (escolhida para a FEAT-005) |
| (B) Tool `create_event` + loop de tool-use do brain agora | Entrega a forma final de uma vez | Constrói o coração da FEAT-006 dentro da FEAT-005; contraria o escopo declarado; mereceria ADR próprio do loop | Prematuro — vira a FEAT-006 |

## Consequências

- Positivas: FEAT-005 fica coesa (OAuth, cifra, leitura e escrita determinística de agenda) e entrega valor sem esperar o brain; o serviço do módulo já nasce com o contrato que a tool da FEAT-006 vai consumir — nenhuma reescrita depois.
- Negativas: por ora, criar evento por frase depende do que a triagem Haiku extrai; negociação rica ("acha um horário livre") só chega com o brain (FEAT-006). Débito consciente, não acidental.
- Reversibilidade: alta — quando a FEAT-006 adicionar a tool, ela apenas passa a chamar o mesmo `google-calendar-service`; o caminho determinístico pode conviver ou ser aposentado sem tocar na integração.
