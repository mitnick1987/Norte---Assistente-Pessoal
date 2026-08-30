# FEAT-002 — Task-store e captura de texto com atrito zero

**Status:** entregue · **Issue:** #6 · **Branch:** `feature/FEAT-002-task-store-captura` · **Data:** 2026-08-25

## Contexto e objetivo

A FEAT-001 provou o pipeline ponta a ponta sem nenhum LLM no caminho (`echo`: "ping" → "pong"). Esta feature é a primeira que cumpre a promessa central do produto: anotar o que o dono manda, sem fazer nenhuma pergunta de estrutura. Atende RF-01 (captura de texto), RF-07 (executor determinístico) e lança a base do RF-15 (monitor de custo — registro de tokens por chamada; o alerta de projeção mensal e o alarme de `cache_read=0` ficam para quando existir volume real de uso).

Três coisas nascem juntas aqui porque nenhuma faz sentido sozinha: o `task-store` (fonte da verdade determinística, ADR-009), o `core/llm` (primeiro cliente de modelo do projeto, ADR-007/ADR-017) e o módulo `capture` (a ponte entre os dois, no fluxo 5 do PRD §6). O `modules/echo` sai de cena — era prova de conceito, e o item real que ele provava (comando determinístico sem LLM) passa a ser exercitado pelo executor desta feature.

O recorte desta entrega é deliberadamente estreito: só texto (áudio é RF-02, fora), só triagem Haiku (o brain Sonnet é feature futura), só lembrete pontual (cadeias de compromisso — véspera/manhã/saída — dependem de `chains`, ainda não existe). O objetivo não é o produto completo, é provar que o núcleo "capturar sem atrito, nunca perguntar estrutura, nunca inventar registro" funciona de ponta a ponta com um LLM real no meio, sob teste.

## Escopo

1. **Módulo `modules/tasks`** (task-store):
   - Migrações próprias (prefixo `tasks_`) para a tabela `items`: `tipo` (`tarefa|ideia|compromisso|lembrete|nota`), `origem`, `status` (`inbox|ativa|em_andamento|feita|adiada|arquivada|dropada`), `prioridade`, `due_at` (TZ `America/Sao_Paulo`), `adiamentos_count` (coluna existe, nunca sai da camada de domínio — ver ADR-009 e RF-11).
   - Serviço de domínio com as regras de transição de estado (quais transições são válidas a partir de cada status; toda transição passa por esse serviço, nunca por `UPDATE` direto fora dele).
   - Deleção sempre lógica: dropar/arquivar é `status = dropada|arquivada`, nunca `DELETE` (ADR-009).
   - Tools strict registradas no manifesto do módulo (`additionalProperties: false`, validação zod no backend antes de qualquer escrita): `create_item`, `complete_item`, `snooze_item`, `drop_item`, `list_items`. O registry continua transport-agnostic (ADR-014) — as mesmas tools serão servidas pelo MCP no M2, sem mudança de forma.
   - `list_items` nunca retorna `adiamentos_count` no payload de saída — omissão testada, não só "não exibida na formatação".

2. **`core/llm` nasce aqui:**
   - Cliente Anthropic autenticado por API key, atrás de uma interface de provedor plugável (ADR-017) — nesta feature só o provider `anthropic-api-key` existe; `claude-account`/`openai-account` (OAuth, M3) não são implementados, só a interface deixa espaço para eles.
   - Toda chamada registra `tokens_in`, `tokens_out` e `cache_read_tokens` na tabela `messages` já existente (base do RF-15; o cálculo de projeção mensal e o alarme de cache fica para quando houver série de dados real).
   - Timeout configurável e erro tratado (a chamada nunca derruba o processo; erro vira exceção tipada que o chamador decide como tratar — na triagem, erro cai em resposta padrão, nunca em silêncio).
   - Sem prompt caching elaborado nesta feature (fora de escopo, ver abaixo) — o prompt da triagem é curto o bastante para não precisar.

3. **Módulo `capture`:**
   - No webhook, mensagem de texto passa pela triagem Haiku 4.5 (`claude-haiku-4-5-20251001`, fixado pelo ADR-007) com output estruturado: `captura | comando | conversa` + itens extraídos (tipo, título, data/hora opcional).
   - Captura grava via tools do task-store e confirma em **1 linha**, sem nenhuma pergunta de estrutura — proibição codificada no prompt da triagem e verificada por teste adversarial (RF-01).
   - Classificação ambígua cai em `status = inbox` (resolução fica para o briefing, feature futura — aqui só garante que não trava nem pergunta).
   - Item com data/hora extraída agenda um lembrete pontual por template na tabela `jobs` existente — disparado pelo scheduler já implementado na FEAT-001, caminho sem LLM (RF-03).

4. **Executor determinístico** — decidido por coesão dentro de `modules/tasks` (não em módulo `commands` separado): as regras de transição e o parsing leve vivem ao lado do serviço que já as implementa; um módulo `commands` só para hospedar matchers seria uma camada sem responsabilidade própria.
   - Padrões resolvidos por código, sem LLM: "feito", "adia [quando]", "dropa", "lista"/"me mostra tudo", e respostas numéricas referentes ao último item citado na conversa.
   - Parsing leve de data relativa em PT-BR para "adia" (ver domínio de datas abaixo).
   - Conclusão ("feito") gera reconhecimento imediato em 1 linha, formulação variada, banco de variações estático (sem LLM) — RF-07, RF-14.

5. **Conversa (mensagem que não é captura nem comando):** resposta padrão curta e honesta, sem chamar o Sonnet (o brain chega em feature futura). Não é um "não entendi" evasivo — é honesta sobre o que o sistema ainda não faz.

6. **Tom RSD-safe desde já (RF-14):**
   - Todas as mensagens gerais desta entrega (confirmação de captura, reconhecimento de conclusão, resposta padrão de conversa) são templates com banco de variações estático — testáveis deterministicamente, sem depender de amostragem de LLM.
   - O prompt da triagem é testado para nunca gerar pergunta de estrutura (projeto/prazo/categoria/tag) nas saídas.
   - Primeira versão da suite de regressão de tom em `tests/tone/` (ver TESTING.md §4.1) — casos adversariais cobrindo os templates desta entrega.

7. **Env novo:** `ANTHROPIC_API_KEY` (área sensível — chave de API em texto, nunca em log; ver SECURITY.md).

## Fora de escopo

- Áudio/STT (RF-02) — entrada de texto só; áudio é feature própria.
- Foto/vision (RF-16, M2).
- Cadeias de compromisso (véspera/manhã/hora de sair) — dependem de `modules/chains`, que não existe ainda; aqui só lembrete **pontual** por template.
- Briefing matinal e revisão noturna (`modules/rituals`, RF-05/RF-06) — a resolução de itens `inbox` fica pendente até essa feature existir.
- Cobranças / fechamento de loop (`modules/nudges`, RF-08).
- Google Calendar (RF-12, módulo de integração próprio).
- Conversa livre com Sonnet — o "brain" é feature futura; aqui a conversa recebe resposta padrão, nunca chamada ao Sonnet.
- Prompt caching elaborado — a triagem Haiku usa prompt curto, sem os fragmentos multi-módulo que justificariam caching agora; caching byte-estável entra com o brain (ADR-007).
- MCP / canal API (ADR-014, ADR-016, M2) — as tools nascem transport-agnostic (pré-requisito já cumprido pela FEAT-001), mas nenhum transporte novo é implementado aqui.
- Higiene automática da lista (RF-11) — a coluna `adiamentos_count` existe e é protegida, mas a proposta de arquivar/dropar por inatividade é do `modules/hygiene`, feature futura.

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| Executor determinístico vive dentro de `modules/tasks`, não em módulo `commands` separado | Módulo `commands` dedicado, plugado via `CommandMatcher` do kernel, importando o contrato público de `tasks` | As regras de transição de estado e o parsing dos comandos ("feito", "adia", "dropa") são a mesma lógica de domínio do task-store vista por outro ângulo — separar em módulo à parte criaria uma fronteira artificial (import cruzado constante) sem ganho de coesão; o kernel já suporta um módulo contribuir `commands` e `tools` ao mesmo tempo |
| `core/llm` com interface de provedor plugável desde o primeiro cliente, mas só implementando `anthropic-api-key` | Cliente Anthropic direto, sem abstração de provedor, adicionada só no M3 quando `claude-account`/`openai-account` existirem | ADR-017 já decidiu a forma da interface; adiar a abstração para o M3 significaria reescrever todo call-site de `core/llm` que a triagem e o executor desta feature já vão criar — mais barato nascer certo |
| Lembrete pontual da captura usa o mesmo mecanismo de `jobs` + template da FEAT-001, sem depender de `chains` | Esperar `modules/chains` existir e tratar todo lembrete (pontual ou em cadeia) por um único caminho | RF-03 (motor de lembretes) já é genérico o bastante para um job `tipo: reminder` avulso; conceitualmente lembrete pontual de captura e cadeia de compromisso são casos de uso diferentes (uma data solta vs. um evento com preparo/deslocamento) — forçar os dois pelo mesmo gerador antes de `chains` existir era acoplamento prematuro |

(Nenhuma decisão nova de arquitetura de impacto duradouro — a forma do provider plugável já está fixada no ADR-017, a estratégia de modelos no ADR-007, deleção lógica no ADR-009 e o registry transport-agnostic no ADR-014.)

## Impacto técnico

- **Banco:** migrações novas de `modules/tasks` (tabela `items`); nenhuma migração nova em `core/` — `messages` e `jobs` já existem desde a FEAT-001, esta feature só passa a escrever nelas (`tokens_in`/`tokens_out`/`cache_read_tokens` em `messages`; jobs `tipo: reminder` avulsos em `jobs`). Sem dado de cliente, sistema single-user; sem migração de dados existentes.
- **API:** nenhuma rota HTTP nova — toda a superfície continua sendo `POST /webhook/evolution` (FEAT-001), agora com um caminho de processamento real (triagem → captura/comando/conversa) em vez do matcher fixo do `echo`.
- **Frontend:** nenhum — interface 100% WhatsApp.
- **Permissões:** sistema single-user; sem mudança no controle de acesso (continua o filtro de JID da FEAT-001).
- **Áreas sensíveis tocadas** (gatilho de `security-auditor` obrigatório antes do merge): variável de ambiente nova (`ANTHROPIC_API_KEY`) e o primeiro caminho de dado do usuário saindo para um provedor externo (API Claude) — validar que a chave nunca aparece em log e que o corpo da chamada ao LLM não vaza dado sensível além do necessário.

## Testes

| Tipo | O que cobre |
|---|---|
| Unit — task-store | Transições de estado válidas/inválidas por status de origem; deleção lógica (dropar/arquivar nunca gera `DELETE`, sempre `status`); `adiamentos_count` nunca sai do domínio (omitido do payload de `list_items`, testado por asserção direta na saída, não só na formatação da mensagem). |
| Unit — parsing de datas | Datas relativas em PT-BR ("sexta", "amanhã 14h", "segunda que vem") resolvidas em `America/Sao_Paulo`; casos cruzando virada de semana e de mês. |
| Unit — triagem (LLM stubado) | Schemas de entrada/saída da triagem (round-trip); classificação ambígua cai em `inbox`; nenhuma saída stubada nem prompt gerado contém pergunta de estrutura (projeto/prazo/categoria/tag). |
| Unit — `core/llm` | Timeout tratado sem derrubar o processo; erro da API vira exceção tipada; `tokens_in`/`tokens_out`/`cache_read_tokens` extraídos corretamente da resposta e passados para persistência. |
| Integração | `fastify.inject()` contra SQLite real, LLM stubado: webhook (texto) → triagem → captura → confirmação de 1 linha no outbox, sem pergunta; webhook → "feito" → reconhecimento imediato no outbox; lembrete pontual: item com data/hora → job criado em `jobs` → avanço de tempo simulado → disparo por template, sem chamada ao LLM no caminho do disparo; registro de tokens: chamada real (stubada) grava `tokens_in`/`tokens_out`/`cache_read_tokens` em `messages`. |
| Segurança/isolamento | Suite S1..S10 do TESTING.md §3 permanece intacta (S3, S4, S5 agora exercitadas de verdade pela primeira vez, com as tools reais do task-store — na FEAT-001 dependiam de módulo de domínio inexistente). Novo: `ANTHROPIC_API_KEY` nunca aparece em log (extensão de S9). |
| Suite de TOM (`tests/tone/`) | Confirmação de captura, reconhecimento de conclusão e resposta padrão de conversa passam pelos padrões proibidos do TESTING.md §4.1 (nenhum tom de fiscal, nenhuma menção a `adiamentos_count` ou paráfrase); teste de prompt dedicado: a triagem nunca responde com pergunta de estrutura, mesmo em entradas adversariais (mensagem ambígua, mensagem com múltiplos itens misturados). |
| E2E (fluxo de negócio) | Fluxo 1 do PRD §6 fatiado ao texto (áudio fica para RF-02): mensagem de texto → triagem → item gravado → confirmação de 1 linha; mensagem "feito" → reconhecimento; mensagem com data/hora → lembrete pontual disparado no horário simulado. |

## Como validar manualmente

Com `ANTHROPIC_API_KEY` real preenchida no `.env` local:

1. Enviar "lembra de pagar o boleto sexta 14h" pelo número configurado em `OWNER_WHATSAPP_JID`: confirmação chega em 1 linha, sem nenhuma pergunta, em até 15s.
2. Esperar (ou simular) a chegada de sexta-feira 14h: o lembrete pontual chega por template, sem novo acionamento de LLM.
3. Enviar "feito": reconhecimento imediato em 1 linha, tom neutro, sem menção a adiamentos ou histórico.
4. Enviar "me mostra tudo": lista completa dos itens ativos aparece (sem `adiamentos_count` em nenhuma linha).
5. Enviar uma mensagem aleatória sem intenção de captura/comando (ex.: "que dia é hoje?"): resposta padrão curta e honesta, sem chamada ao Sonnet.

---

## Entrega (preencher no fim, antes do merge)

- **O que foi feito:** todo o escopo da spec entrou — `modules/tasks` (task-store com migrações, serviço de transição de estado, deleção lógica, tools strict, executor determinístico em `commands.ts`), `core/llm` (provider Anthropic plugável, registro de uso em `messages`) e `modules/capture` (triagem Haiku, captura, lembrete pontual, tom RSD-safe). `modules/echo` saiu. Commit principal `a39a0d0`; review multi-agente levantou 4 achados bloqueante/importante e 5 sugestões, todos corrigidos no commit `c7ea07e`. Suite em 47 arquivos de teste / 278 testes, verde.

  Quatro pontos merecem destaque por não estarem óbvios lendo só o escopo acima:

  1. **ADR-018 nasceu no meio da implementação, não antes dela.** A spec original assumia processamento síncrono no handler do webhook (era o padrão herdado da FEAT-001, que não tinha I/O externo no caminho). Ao ligar a triagem Haiku de verdade — chamada de rede com timeout de até 15s — ficou claro que segurar a conexão HTTP da Evolution por esse tempo violava o ARCHITECTURE.md §5 e arriscava reentrega por timeout. O implementador escalou a decisão em vez de seguir a spec às cegas; a saída (ACK imediato + processamento em background no mesmo processo + varredura de recuperação no boot com teto por subida) está registrada no [ADR-018](../adr/ADR-018-webhook-ack-processamento-assincrono.md) e foi decidida antes de codar, não depois. Isso adicionou uma máquina de estados nova em `messages` (`pending`/`failed`) e o método `waitForPendingProcessing` em `App` (só para teste — nunca usado no boot real), que não constavam da spec original.

  2. **Data relativa nunca sai do Haiku como data absoluta** — isso já estava implícito no ADR-006, mas a primeira versão da triagem (antes do review) deixava o modelo tentar calcular a data. O review classificou isso como achado bloqueante: o Haiku não tem como saber o dia de hoje nem o fuso sem alucinar. A correção (`c7ea07e`) trocou o contrato: a triagem devolve `dueExpression` (a expressão como o usuário falou — "sexta 14h", "amanhã") e o backend resolve com `parseRelativeDatePtBr` em `America/Sao_Paulo`, com `now` sempre injetado. Expressão que o parser não reconhece não vira `dueAt`: o item cai em `inbox` e a confirmação avisa que não entendeu a data, sem perguntar estrutura.

  3. **`snoozeCount`, não `adiamentos_count`.** O ER do PRD/ARCHITECTURE usa o nome em português; o CODE_STYLE.md §1 exige identificador em inglês. A coluna física (`ItemRecord.snoozeCount` em `src/modules/tasks/domain/item.ts`) segue a regra de estilo, não o nome literal do ER — é desvio de nome, não de comportamento: a garantia central (nunca expor esse valor ao usuário) está testada em `tests/unit/tasks-tools.test.ts` por asserção direta no payload de `list_items`, não só na formatação da mensagem.

  4. **Matcher de resposta numérica não entrou.** A spec (linha "Padrões resolvidos por código... e respostas numéricas referentes ao último item citado na conversa") previa isso no executor desta feature. Na prática, "responder com o número 2 pra dizer qual item" só faz sentido quando existe um menu numerado na conversa — e isso é `modules/nudges` (RF-08, cobrança/fechamento de loop), que não existe ainda. Implementar o matcher agora seria código morto (nunca acionado, porque nada nesta feature numera itens numa mensagem). Fica para quando `nudges` existir e definir o contrato de "último menu mostrado".

- **Desvios de escopo/arquitetura registrados acima:** ADR-018 (processamento assíncrono, não estava na spec original), contrato de data relativa via `dueExpression` (correção do review, alinhada ao ADR-006), matcher de resposta numérica adiado para `modules/nudges`.
- **PRs:** feature implementada direto na branch `feature/FEAT-002-task-store-captura` (commits `9f46509`, `a39a0d0`, `c7ea07e`); merge para `main` pendente de aprovação do dono do projeto.
- **Migrações:** `001_tasks_items` (tabela `items`), `002_tasks_items_source_message` (`source_message_id`, idempotência por mensagem — insuficiente sozinha, ver 003), `003_tasks_items_source_item_index` (`source_item_index` + índice único parcial `(source_message_id, source_item_index) WHERE source_message_id IS NOT NULL` — idempotência granular por item, corrigida no review porque a versão por mensagem inteira perdia itens 2..N de uma captura multi-item que crashasse no meio).
- **Pendências/débitos:** nenhum `TODO` novo aberto nesta feature. Itens que ficaram de fora são escopo futuro já mapeado em "Fora de escopo" (chains, rituals, nudges, hygiene, MCP) — não são débito desta entrega.
- **Aprendizados:**
  - O `jid` passado para `recordLlmUsage`/`onUsage` (registro de tokens, RF-15) é derivado da mensagem que está sendo processada (`triage-service.ts`), não mais um `ownerJid` fixo capturado no boot — importa se algum dia o sistema deixar de ser single-user, mas já é o padrão certo agora porque a varredura de recuperação processa mensagens de boots anteriores, potencialmente com contexto diferente do boot atual.
  - Testes de segredo (`tests/security/anthropic-secrets.test.ts`) precisam esperar o processamento em background terminar (`waitForPendingProcessing`) antes de inspecionar o log — como o processamento não é mais síncrono ao webhook (ADR-018), um teste que verifica o log logo após o `inject()` responder corre antes da chamada ao Anthropic acontecer, e passa por acidente sem testar nada.
  - `ANTHROPIC_API_KEY` está no `.env.example` deste repo, mas foi adição manual do dono do projeto — o arquivo tem ACL restrita para edição automatizada neste ambiente. Quem for adicionar env var nova precisa saber que essa etapa não é automatizável e não esquecer de pedir.
  - **Nota de divergência spec × código:** a spec (Escopo, item 4) descreve o executor como parte de `modules/tasks` sem citar arquivo; ele vive em `src/modules/tasks/commands.ts`, exportando `buildTasksCommands`. Não é uma divergência de decisão (a spec já explicava por que não é módulo `commands` separado), só o caminho concreto do arquivo para quem for procurar.
