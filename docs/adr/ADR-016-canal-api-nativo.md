# ADR-016 — Canal API nativo compatível com OpenAI/Anthropic (estilo 9router)

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ADR-014, ADR-015, ARCHITECTURE.md §2 (core/channel), PRD RF-32

## Contexto

Requisito do dono: além do MCP (ADR-014), integração **nativa** com as ferramentas de IA, no modelo do 9router — um gateway local que expõe um endpoint compatível com a API da OpenAI em `localhost`, para o qual Claude Code, Codex, Cursor, Cline e similares apontam o base URL e conversam **pelo protocolo que já falam**, sem plugin nem configuração de MCP.

Para o Norte, isso significa ser acessível como se fosse um provedor de modelo: qualquer ferramenta com suporte a base URL customizado conversa com o assistente diretamente. O encaixe na arquitetura é natural: a interface `Channel` (ARCHITECTURE §2) já abstrai "por onde chegam e saem mensagens" — WhatsApp é a primeira implementação; um endpoint HTTP compatível é a segunda.

## Decisão

1. O Norte expõe um **canal API nativo** (`core/channel/api-compat`, M2): `POST /v1/chat/completions` (formato OpenAI, com streaming SSE) e `POST /v1/messages` (formato Anthropic), autenticados por token dedicado (`API_CHANNEL_TOKEN`).
2. Mensagens que chegam por esse canal entram no **mesmo funil** do WhatsApp (triagem → executor/brain → task-store) e a resposta volta síncrona no formato do protocolo chamado. Mesmas tools, mesma validação, mesmos limites; auditoria com origem `api`.
3. Escopo do canal é **conversa com o Norte** ("o que tenho pra hoje?", "anota X", "conclui Y") — ele não é proxy para outros modelos nem roteador de provedores (isso é o 9router; o Norte não compete com ele, se integra ao lado dele).
4. Perfis (ADR-013): local = porta em localhost; produção = atrás do Caddy com token. Nunca exposto sem autenticação.
5. As três vias de integração convivem, cada uma com seu papel: **API nativa** para conversar com o Norte de qualquer ferramenta (base URL), **MCP** para agentes operarem o task-store como tools tipadas (ADR-014), **orquestração de CLIs** para o Norte delegar trabalho de código (ADR-015).

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Só MCP | Uma via a manter | Exige configurar MCP em cada ferramenta; ferramentas sem cliente MCP ficam de fora; não atende o requisito "nativa" | O dono pediu a via de base URL explicitamente |
| Endpoint compatível OpenAI + Anthropic como segundo Channel | Qualquer ferramenta com base URL customizado conecta sem plugin; reuso total do funil; formatos amplamente documentados | Duas superfícies de compatibilidade para acompanhar (mudanças de formato, streaming SSE); mais um token a gerenciar | — (escolhida) |
| Protocolo próprio + SDKs | Controle total | Ninguém fala protocolo próprio de graça — mataria a "integração nativa" | Contradiz o objetivo |

## Consequências

- Positivas: o Norte vira acessível de dentro de qualquer ferramenta de IA que o dono use, com configuração de uma linha (base URL + token); zero lógica duplicada — o canal é casca de protocolo sobre o funil existente.
- Negativas: compatibilidade de formato (incl. streaming SSE e peculiaridades de cada cliente) vira superfície de manutenção; token do canal é mais um secret com rotação (SECURITY.md §4); rate limit próprio necessário para o canal não drenar o orçamento de API do brain.
- Reversibilidade: alta — canal plugável e removível; a interface `Channel` fica mais bem exercitada (terceira implementação depois de WhatsApp e Telegram dormente).
