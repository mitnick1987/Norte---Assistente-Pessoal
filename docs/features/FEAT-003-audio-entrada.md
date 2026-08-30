# FEAT-003 — Áudio como entrada de primeira classe

**Status:** rascunho · **Issue:** #13 · **Branch:** `feature/FEAT-003-audio-entrada` · **Data:** 2026-08-30

## Contexto e objetivo

A FEAT-002 provou o funil completo de captura — triagem Haiku, task-store, confirmação em 1 linha — mas só para texto. No WhatsApp real, boa parte do que o dono manda em movimento é áudio: é o formato de menor atrito quando as mãos estão ocupadas, exatamente o cenário onde o TDAH mais precisa que a captura não peça nenhum esforço extra. Sem áudio, a promessa central do produto ("captura sem atrito") fica pela metade. Esta feature atende RF-02 do PRD.

A decisão de design que guia tudo aqui: **áudio não é um funil paralelo, é uma nova porta de entrada para o mesmo funil.** A transcrição substitui o texto que o Haiku recebe; daí em diante — triagem, tools do task-store, confirmação em 1 linha, lembrete pontual — é o código já entregue pela FEAT-002, sem duplicação. O que esta feature adiciona de fato é tudo o que existe *antes* da triagem: a interface de transcrição (`core/stt`), a busca ativa da mídia na Evolution e o tratamento de falha (STT indisponível não pode significar silêncio).

`core/stt` nasce com a mesma forma de interface plugável que `core/llm` (ADR-017): um provider primário e um de fallback atrás de um contrato único, para que trocar de fornecedor de transcrição no futuro não implique reescrever o call-site. A escolha de Groq como primário (`whisper-large-v3-turbo`, endpoint OpenAI-compatible) e OpenAI Whisper como fallback é orçamento e latência — Groq é a opção mais barata e mais rápida das duas para esse modelo; OpenAI existe só como rede de segurança quando Groq cai.

## Escopo

1. **`core/stt`** — interface de transcrição isolada:
   - Contrato único `SttProvider` (método de transcrição recebendo áudio binário/base64 + mime type, devolvendo texto transcrito ou erro tipado).
   - Duas implementações: `groq` (primário, `whisper-large-v3-turbo`, endpoint OpenAI-compatible da Groq) e `openai-whisper` (fallback).
   - Seleção automática: tenta o primário; falha (erro de rede, timeout, erro HTTP, corpo de resposta que não é JSON válido) cai automaticamente no fallback; falha dos dois é erro tipado devolvido ao chamador — o tratamento de "falha total" é responsabilidade do módulo `capture` (item 3), não desta camada.
   - Timeout configurável por chamada (settings), igual ao padrão já estabelecido em `core/llm` na FEAT-002 — nenhuma chamada de STT trava o processamento em background indefinidamente.
   - Env novas: `GROQ_API_KEY` (obrigatória para processar áudio — sem ela, `core/stt` nem tenta o primário) e `OPENAI_API_KEY` (opcional; ausência dela só desativa o fallback, não é erro de boot). Nenhuma das duas aparece em log, nunca (extensão de S9, ver Testes).

2. **Webhook/adapter — aceitar `audioMessage`:**
   - O adapter Evolution (`core/channel/whatsapp-evolution`) passa a reconhecer `audioMessage` no payload de `MESSAGES_UPSERT`, ao lado do texto já tratado na FEAT-002.
   - A mídia é **sempre buscada ativamente** via `getBase64FromMediaMessage` contra a Evolution autenticada — o base64 que eventualmente venha embutido no payload do webhook nunca é usado (SECURITY.md §6, ARCHITECTURE.md §4.1). Isso vale mesmo que o payload pareça já trazer o áudio pronto.
   - A mensagem de entrada é persistida como `pending` com `media_type` preenchido, seguindo a máquina de estados do ADR-018 — o dispatcher assíncrono da FEAT-002 (ACK imediato + processamento em background + varredura no boot) é reaproveitado sem modificação estrutural; áudio só acrescenta um passo (busca de mídia + STT) antes da triagem, no mesmo pipeline.
   - A transcrição obtida é gravada na coluna `transcricao` da tabela `messages` antes de seguir para a triagem — fica registrada mesmo que uma etapa posterior falhe, para depuração e para a varredura de recuperação (item 4).

3. **Fluxo — mesmo funil da captura de texto:**
   - Transcrição pronta entra na triagem Haiku exatamente como o texto da FEAT-002 entraria — nenhum prompt, schema ou serviço novo de triagem; a diferença é só a origem do texto de entrada.
   - Áudio com N assuntos gera N itens gravados via tools do task-store, confirmados numa **única** resposta (mesma regra de "nunca perguntar estrutura" e "confirmação em 1 linha" da FEAT-002, agora testada também para o caminho de áudio).
   - **Falha total de STT** (primário e fallback ambos falharam): a mensagem é marcada `failed` com log de erro (nunca fica presa em silêncio, nunca tenta adivinhar o conteúdo), e o outbox recebe uma resposta pedindo o conteúdo por texto. O tom é RSD-safe — pede, não culpa ("não consegui ouvir esse áudio agora, me manda em texto?" e variações, nunca "o áudio falhou" como se fosse culpa do usuário nem justificativa técnica exposta).

4. **Varredura de recuperação (pending-recovery) passa a cobrir áudio:**
   - Mensagens de áudio `pending` encontradas na varredura do boot (ADR-018) são reprocessadas: a mídia é buscada de novo via `getBase64FromMediaMessage`.
   - Se a mídia expirou na Evolution (busca retorna erro de mídia indisponível), a varredura **não tenta STT** — responde pedindo o conteúdo por texto (mesma mensagem de falha total do item 3) e marca a mensagem `processed` (não `failed`): a mídia expirada não é uma falha do sistema a reter para nova tentativa, é uma janela de tempo que já passou; manter em `pending` geraria reprocessamento infinito no boot seguinte sem nunca poder ter sucesso.

5. **Timeouts e limites:**
   - Timeout por chamada de STT (settings, mesmo padrão de `core/llm`) — chamada que trava não segura o processamento em background indefinidamente; timeout do primário aciona o fallback como qualquer outra falha.
   - Limite de duração/tamanho de áudio (settings, com default sensato): áudio acima do limite não é enviado a nenhum provedor de STT — resposta educada explicando o limite, tom RSD-safe, sem chamar a API externa à toa.

## Fora de escopo

- Foto/vision (RF-16, M2) — módulo `vision` próprio, não existe ainda.
- Voz sintetizada de resposta (TTS) — o Norte responde em texto; não há requisito de produto para resposta em áudio.
- Diarização (separar falantes num mesmo áudio) — não há caso de uso; o dono é sempre o único falante relevante.
- Tradução — transcrição é sempre no idioma falado; nenhuma camada de tradução entra no funil.
- Qualquer mudança no task-store, na triagem Haiku ou no executor determinístico — todos herdados da FEAT-002 sem alteração; esta feature só adiciona o que vem antes deles.

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| `core/stt` com interface plugável (provider primário + fallback) desde o início, mesmo padrão de `core/llm` (ADR-017) | Cliente Groq direto, sem abstração, fallback OpenAI adicionado depois se necessário | O requisito de fallback automático já está no RF-02 desde o PRD — não é aditivo futuro, é parte do escopo mínimo; nascer com a interface certa evita reescrever call-site quando o fallback for implementado |
| Áudio reaproveita o pipeline assíncrono do ADR-018 sem alteração estrutural — só acrescenta um passo (busca de mídia + STT) antes da triagem | Pipeline de processamento próprio para mídia, com sua própria máquina de estados | O ADR-018 já resolve exatamente o problema que uma chamada de STT (rede, latência, pode falhar) recria; duplicar a máquina de estados para "mais um tipo de I/O externo antes da triagem" seria a mesma solução com nome diferente |
| Mídia expirada na varredura de recuperação marca a mensagem `processed` (não `failed`, não fica em `pending` para nova tentativa) | Manter `pending` e tentar de novo no próximo boot; marcar `failed` como qualquer outra falha de processamento | Mídia expirada na Evolution nunca vai ter sucesso em uma tentativa futura — reter como `pending` é reprocessamento infinito sem chance de resolver; `failed` sugeriria erro do sistema quando na verdade é uma janela de tempo (mídia com TTL) que já passou. `processed` reflete que o sistema tratou o caso da forma possível (pediu texto) e não há mais ação pendente |

(Nenhuma decisão nova de arquitetura de impacto duradouro fora das acima — a forma de provider plugável já estava prevista no ADR-017 e é só replicada para STT; o pipeline assíncrono é o ADR-018 sem modificação.)

## Impacto técnico

- **Banco:** nenhuma migração nova. A coluna `transcricao` e `media_type` em `messages` já existem desde a base do schema (FEAT-001/FEAT-002); esta feature passa a escrevê-las de fato pela primeira vez. Sem dado de cliente, sistema single-user; sem migração de dados existentes.
- **API:** nenhuma rota HTTP nova. `POST /webhook/evolution` passa a aceitar `audioMessage` como um segundo formato de payload de entrada, além do texto.
- **Frontend:** nenhum — interface 100% WhatsApp.
- **Permissões:** sem mudança — continua o filtro de JID da FEAT-001, aplicado antes de qualquer processamento (inclusive antes da busca de mídia).
- **Áreas sensíveis tocadas** (gatilho de `security-auditor` obrigatório antes do merge): duas variáveis de ambiente novas (`GROQ_API_KEY`, `OPENAI_API_KEY`) e um segundo caminho de dado do usuário saindo para provedores externos (Groq e, em fallback, OpenAI) — validar que nenhuma das duas chaves aparece em log, que a busca de mídia nunca confia no base64 do payload do webhook (SECURITY.md §6) e que o áudio em si (dado potencialmente sensível) não é retido além do necessário para a chamada de STT.
- **Pendência conhecida:** `.env.example` tem ACL restrita para edição automatizada neste ambiente (mesma pendência registrada na Entrega da FEAT-002 para `ANTHROPIC_API_KEY`) — `GROQ_API_KEY` e `OPENAI_API_KEY` precisam ser adicionadas manualmente pelo dono do projeto; não é automatizável nesta implementação.

## Testes

| Tipo | O que cobre |
|---|---|
| Unit — providers de STT | `groq` e `openai-whisper` com fetch stubado: sucesso (texto extraído corretamente da resposta), erro HTTP (4xx/5xx tratado como falha tipada, nunca exceção não tratada), corpo de resposta não-JSON (mesmo endurecimento aplicado a `core/llm` na FEAT-002). |
| Unit — fallback | Falha do primário (Groq) aciona automaticamente o secundário (OpenAI); falha dos dois devolve erro tipado ao chamador; sucesso do primário nunca aciona o secundário (sem chamada dupla). Timeout do primário é tratado como falha e também aciona o fallback. |
| Unit — limites | Áudio acima do limite de duração/tamanho configurado em settings não gera nenhuma chamada a provider de STT (assertion de que o client não foi invocado); resposta educada é gerada no lugar. |
| Integração | Webhook de áudio → `getBase64FromMediaMessage` (stub) → STT stubado → triagem stubada → N itens gravados no task-store → confirmação **única** no outbox; falha total de STT (ambos providers falhando no stub) → resposta pedindo texto no outbox, mensagem marcada `failed` com log; recuperação no boot: mensagem de áudio `pending` com mídia disponível é reprocessada com sucesso; mensagem de áudio `pending` com mídia expirada (stub de erro de mídia indisponível) responde pedindo texto e marca `processed`. |
| Segurança/isolamento | S9 (TESTING.md §3) estendida: `GROQ_API_KEY` e `OPENAI_API_KEY` nunca aparecem em log, mesmo em `debug` — asserção direta sobre a saída do logger. S10 estendida: payload de áudio malformado (campos de mídia ausentes, tipo inesperado) é rejeitado pela validação zod, processo não derruba. Confirma que a busca de mídia nunca usa base64 do payload do webhook, mesmo quando presente (teste dedicado, não só ausência de uso incidental). |
| Suite de TOM (`tests/tone/`) | Mensagem de falha total de STT passa pelos padrões proibidos do TESTING.md §4.1 (nenhum tom de culpa, nenhuma exposição de erro técnico ao usuário); mensagem de limite de duração/tamanho excedido é educada, sem tom de repreensão. |
| E2E (fluxo de negócio) | Fluxo de captura por áudio do PRD §6: webhook de áudio simulado → STT stubado com múltiplos assuntos → N itens no task-store → 1 mensagem de confirmação no outbox, sem nenhuma pergunta de estrutura (mesmo cenário já previsto no TESTING.md §4, item 1, agora implementado de fato). |

## Como validar manualmente

Com `GROQ_API_KEY` real preenchida no `.env` local (e `OPENAI_API_KEY` opcionalmente, para testar o fallback):

1. Mandar um áudio dizendo "lembra de comprar ração amanhã e marcar dentista sexta" pelo número configurado em `OWNER_WHATSAPP_JID`: chega **1 resposta** confirmando os 2 itens, sem nenhuma pergunta de estrutura.
2. Mandar um áudio com música ou ruído (sem fala reconhecível): resposta pede o conteúdo por texto, tom RSD-safe, sem menção a erro técnico.
3. Mandar um áudio acima do limite de duração configurado em settings: resposta educada informando o limite, sem tentar transcrever.
4. (Opcional, para validar fallback) Derrubar `GROQ_API_KEY` temporariamente (valor inválido) mantendo `OPENAI_API_KEY` válida: áudio ainda é transcrito com sucesso via OpenAI Whisper.

---

## Entrega (preencher no fim, antes do merge)

- **O que foi feito:** todo o escopo da spec, no backend. `core/stt`: contrato `SttProvider`, `GroqSttProvider` (primário, `whisper-large-v3-turbo`, endpoint OpenAI-compatible) e `OpenAiWhisperProvider` (fallback), ambos com timeout configurável e endurecimento contra corpo de resposta não-JSON; `SttRouter` com seleção automática (falha tratada do primário aciona o fallback; falha dos dois devolve `{ kind: 'error' }`, nunca exceção; ausência de `GROQ_API_KEY`/`OPENAI_API_KEY` desativa o provider correspondente sem erro de boot). Adapter Evolution: `audioMessage` modelado no schema zod (mimetype/seconds/fileLength, `.passthrough()` para o resto do protobuf), `IncomingMessage` ganha `audio` + `messageKey`, busca ativa via `getBase64FromMediaMessage` (nunca o base64 do payload — testado inclusive quando o payload traz um campo `base64` dentro de `audioMessage`), `MediaUnavailableError` tipado para distinguir mídia indisponível/expirada de outras falhas. Webhook e varredura de recuperação ganham pontos de extensão simétricos (`onAudioMessage`/`onAudioRecovery`) sem o `core` conhecer `capture`. `modules/capture`: `AudioCaptureService` orquestra checagem de limite (settings `capture.audioMaxDurationSeconds`/`capture.audioMaxFileSizeBytes`, default 10min/20MB) → busca de mídia → STT → grava `transcricao` → delega ao MESMO `dispatch` de texto da FEAT-002 (nenhum prompt/schema/serviço de triagem novo). Falha total de STT (`SttTotalFailureError`) enfileira mensagem RSD-safe pedindo texto e propaga para o webhook marcar `failed` com log de erro; na recuperação, mídia expirada (`MediaUnavailableError`) marca `processed` em vez de `failed` (mídia com TTL vencido nunca teria sucesso numa retentativa) — falha total de STT na recuperação (mídia obtida, STT indisponível) segue a regra geral e marca `failed`. Áudio acima do limite não gera nenhuma chamada a provider de STT nem busca de mídia.
- **PRs:** (preenchido pelo orquestrador ao abrir o PR)
- **Migrações:** `006_core_messages_media` (`src/core/db/migrations/006_core_messages_media.ts`) — adiciona `media_type`, `transcricao` e `message_key_json` a `messages`, com `down` testado. Ver "Desvios da spec" abaixo: a spec previa essas colunas como já existentes; não estavam.
- **Pendências/débitos:** `.env.example` não pôde ser editado neste ambiente (ACL restrita, mesma pendência já registrada na Entrega da FEAT-002 para `ANTHROPIC_API_KEY`) — `GROQ_API_KEY` e `OPENAI_API_KEY` precisam ser adicionadas manualmente pelo dono antes de testar o fluxo real de ponta a ponta (validação manual da spec).
- **Desvios da spec:** a seção "Impacto técnico" afirma que `transcricao` e `media_type` "já existem desde a base do schema (FEAT-001/FEAT-002)" — não existiam (conferido em `src/core/db/migrations/`, só até `005_core_messages_processing_status`). Criada a migração `006_core_messages_media` para as duas colunas mais `message_key_json` (necessária para a varredura de recuperação buscar a mídia de novo depois de um restart — a `key` original precisa sobreviver ao processo, e a spec não detalhava esse mecanismo). Fora isso, nenhum desvio de comportamento: seleção automática de STT, busca ativa de mídia, reaproveitamento do pipeline ADR-018, tratamento de falha total e de mídia expirada seguem a spec item a item.
- **Aprendizados:** a spec (item 3) diz "a mensagem é marcada `failed` com log de erro" para falha total de STT, mas não deixa óbvio que isso exige o serviço de áudio **lançar** um erro tipado (em vez de só tratar e retornar) para o webhook/recovery aplicarem esse status — o design inicial retornava normalmente após enfileirar a mensagem de fallback, o que teria marcado `processed` em vez de `failed`; a suite de integração pegou a divergência ao comparar contra o texto exato da spec antes de fechar a tarefa. `SttTotalFailureError` resolve isso de forma explícita e testável.
