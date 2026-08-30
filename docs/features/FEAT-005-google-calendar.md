# FEAT-005 — Google Calendar em linguagem natural (RF-12)

**Status:** entregue · **Issue:** #15 · **Branch:** `feature/FEAT-005-google-calendar` · **Data:** 2026-08-30

## Contexto e objetivo

A FEAT-004 entregou `events` e a cadeia de lembretes, mas com uma limitação assumida desde o início: `gcal_id` fica nulo, a agenda é só a que o próprio Norte cria a partir de captura por frase. Isso não é a promessa do RF-12 nem do PRD — o usuário tem uma agenda real no Google Calendar, cheia de compromissos que não passaram pela captura do WhatsApp (reunião marcada pelo trabalho, consulta marcada por outra pessoa). Sem ler essa agenda, o briefing (FEAT-006) mentiria por omissão e as cadeias de lembrete só cobririam metade dos compromissos do dia.

Esta feature fecha essa lacuna nas duas direções previstas pelo PRD §6 fluxo 3: **leitura** (agenda do Calendar alimenta briefing e cadeias) e **escrita** ("marca dentista quinta 16h" cria o evento no Google e no Norte via tool `create_event`). As duas direções reusam a mesma infraestrutura de `events`/cadeias que a FEAT-004 já deixou pronta — o Calendar não cria um conceito novo de compromisso, só uma segunda fonte (e um segundo destino) para o que já existe.

A tese de confiabilidade do PRD (§1, tese 2) se aplica com força redobrada aqui: a integração com um provedor OAuth externo é, por natureza, o tipo de dependência que "quebra em silêncio" (ADR-010) — token expira, refresh falha, escopo é revogado. Por isso o ADR-010 já fixou a decisão de arquitetura (app External "In Production", escopo mínimo, alerta de e-mail em falha de refresh) antes desta implementação; esta spec instancia essa decisão em código: cliente OAuth, tabela `auth_tokens` cifrada, refresh automático e o alerta correspondente.

Esta é também a primeira feature do produto que fala com um provedor de terceiro autenticado por OAuth de usuário (distinta de uma API key de serviço como a da Anthropic) — o padrão de setup manual único (o dono autoriza uma vez, pelo navegador) e de tokens cifrados em repouso estabelecido aqui é o mesmo que RF-22 (Gmail, M2) e RF-33 (contas Claude/OpenAI, M3) vão reaproveitar.

## Escopo

1. **`modules/integrations/google-calendar` — cliente OAuth2 e chamadas à API:**
   - Cliente via `googleapis` (biblioteca oficial `google-auth-library` + `googleapis`), não fetch direto — decisão registrada em Decisões tomadas: o volume de chamadas é pequeno (list/create/update de eventos), mas o tratamento de refresh, expiração e formato de erro do OAuth2 do Google já vem resolvido na lib oficial, e reescrever isso à mão é superfície de bug em código que already existe testado por milhares de outros consumidores.
   - Escopo solicitado é só `https://www.googleapis.com/auth/calendar.events` — mínimo necessário para ler e escrever eventos, sem acesso a configurações do calendário ou outros calendários (ADR-010, SECURITY.md §4).
   - Fluxo de autorização inicial: rota HTTP local `GET /setup/google` (fora do webhook público, só acessível localmente/via túnel SSH durante o setup) gera a URL de consent do Google com o escopo acima e `access_type: offline` + `prompt: consent` (força a emissão de `refresh_token`, que o Google só devolve na primeira autorização ou quando forçado); `GET /setup/google/callback` recebe o `code`, troca por `access_token`/`refresh_token` e persiste em `auth_tokens`. É setup manual único do dono — pré-requisito operacional documentado em Como validar manualmente, não uma tela de uso diário (coerente com o não-objetivo do PRD de UI própria fora do M3).
   - Pré-requisito manual do dono, fora do código desta feature: criar o projeto no Google Cloud Console, configurar a tela de consentimento OAuth como **External** e publicá-la como **"In Production"** (ADR-010) — sem isso, o refresh token emitido expira em 7 dias (modo Testing) e a integração quebra silenciosamente toda semana. Documentado como passo obrigatório antes de rodar o setup local.

2. **Entidade `auth_tokens` (ER já previsto no ARCHITECTURE.md §3):**
   - Migração em `modules/integrations/google-calendar/migrations` (a entidade é o primeiro dado próprio deste módulo — não pertence a `tasks`): `provider` (PK, `'google_calendar'` nesta feature), `access_token_cifrado`, `refresh_token_cifrado`, `expiry` (datetime UTC do vencimento do access token), `scopes` (string, escopos concedidos de fato, para detectar downgrade de escopo numa reautorização futura), `updated_at`.
   - Cifra/decifra isoladas num helper testável (`token-cipher.ts`): AES-256-GCM com `TOKEN_ENCRYPTION_KEY` (mesmo padrão do SECURITY.md §4), IV aleatório por operação, prefixado ao ciphertext armazenado; chave errada ou payload adulterado falha a decifra (auth tag do GCM), nunca retorna texto corrompido em silêncio.
   - Refresh automático: antes de qualquer chamada à API, o cliente verifica `expiry`; se vencido (ou a poucos minutos de vencer), troca o `refresh_token` por um `access_token` novo via `google-auth-library` e persiste o resultado antes de prosseguir. Falha de refresh (revogação, erro de rede, credencial inválida) dispara alerta por e-mail (reusa o canal de alertas do RF-13) e propaga o erro para quem chamou — nunca mascara a falha nem finge que a leitura/escrita funcionou.

3. **Leitura — agenda do dia:**
   - `list_events` busca os eventos do dia (calendário `primary`, único suportado — decisão registrada abaixo) diretamente na API do Google **sob demanda**, sem espelhar em tabela própria: decisão por simplicidade (ver Decisões tomadas) — o Calendar já é a fonte da verdade da agenda externa, duplicar em `events` locais criaria um segundo lugar para ficar dessincronizado.
   - Sincronização mínima com cadeias: os eventos do Calendar que têm horário e ainda não têm `event` interno correspondente (deduplicados por `gcal_id`) geram um `event` via `EventService` (reusando a FEAT-004) e disparam `expandChain` — mesma cadeia véspera/manhã/preparo que um compromisso criado por frase já gera. Roda no mesmo pull de leitura (sem job de sincronização periódica dedicado nesta feature — o gatilho é a leitura pelo briefing/comando, que já acontece pelo menos uma vez ao dia).
   - Serve de base para o futuro briefing (FEAT-006): esta feature expõe a função de leitura via serviço público do módulo; FEAT-006 é quem decide como formatar/consumir no ritual.

4. **Escrita — tool `create_event`:**
   - Tool strict (`additionalProperties: false`, schema zod no backend) registrada no `brain`/registry: título, data/hora de início, duração ou horário de fim opcional, local opcional. "Marca dentista quinta 16h" resolve pela mesma triagem de data/hora já usada na captura (FEAT-002/004).
   - Cria o evento no Google Calendar **e** o `event` interno + cadeia (reusa `EventService.create` + `expandChain` da FEAT-004) na mesma operação — o usuário nunca vê os dois passos, só a confirmação de 1 linha.
   - Idempotência: a tool grava o `gcal_id` retornado pelo Google no `event` interno antes de confirmar sucesso; uma segunda chamada com o mesmo evento (reentrega de tool call, retry de rede) é detectada porque o Norte já tem o par item/evento correspondente — não duplica no Google nem internamente.

5. **Env e configuração:**
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (credenciais do app OAuth), `TOKEN_ENCRYPTION_KEY` (chave AES-256-GCM, mesma variável prevista no SECURITY.md §4 — não é exclusiva desta feature, mas esta é a primeira a precisar dela em código) e `GOOGLE_REDIRECT_URI` (URI local de callback, ex. `http://localhost:PORT/setup/google/callback`). As quatro chaves estão documentadas (sem valores) no `.env.example`.

## Fora de escopo

- Gmail (RF-22, M2) — mesmo padrão de OAuth e mesmo `auth_tokens`, mas escopo, cliente e tool são de uma feature futura.
- Briefing matinal em si (RF-05, FEAT-006) — esta feature só expõe `list_events`; a formatação, o fallback em template e o horário do job são da FEAT-006.
- `suggest_time` — sugestão de horário livre não faz parte desta entrega; a tool exposta é só `create_event` com horário já decidido pelo usuário.
- Multi-calendário — só o calendário `primary` do dono é lido/escrito; múltiplos calendários (pessoal + trabalho, por exemplo) ficam para quando houver demanda concreta, com issue própria.
- Eventos recorrentes complexos do Google (RRULE com exceções, séries editadas parcialmente) — tratado como série simples (evento único, sem expansão de recorrência); recorrência avançada é débito com issue (ver Entrega).
- UI de administração para reautorizar/ver status do token (RF-33, M3) — o setup e a eventual reautorização nesta feature são por rota HTTP local + navegador, sem tela própria.
- Checklist de preparação (`prep_itens`, RF-29, M3) — segue fora de escopo, como já registrado na FEAT-004.

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| Cliente via `googleapis` + `google-auth-library` (bibliotecas oficiais), não fetch direto contra a API REST | (a) fetch direto com implementação própria do fluxo OAuth2 e das chamadas REST; (b) outra lib de terceiro não oficial | O fluxo de refresh, expiração e formato de erro do OAuth2 do Google já vem resolvido e testado na lib oficial; volume de chamadas é baixo (não há custo de overhead relevante), e reescrever o protocolo à mão é superfície de bug desnecessária para o ganho de "uma dependência a menos" |
| Agenda do Calendar é lida **sob demanda** (sem espelhar em tabela própria); só os eventos com horário viram `event` interno + cadeia no momento da leitura | Sincronização contínua/bidirecional espelhando toda a agenda do Google em `events` locais | Espelhar cria um segundo lugar para a agenda ficar dessincronizada (edição feita direto no Google, exclusão, etc.) sem ganho real — o briefing e as cadeias só precisam saber o que tem hoje/em breve, não manter uma cópia completa. Mais simples e alinhado ao RNF de manutenibilidade (uma pessoa, sem sincronização bidirecional a depurar) |
| `auth_tokens` migração própria em `modules/integrations/google-calendar`, não em `core/db` nem em `modules/tasks` | (a) tabela genérica em `core` para qualquer provedor OAuth futuro (Gmail, contas Claude/OpenAI); (b) dentro de `tasks` por estar no mesmo ER geral | A tabela é `provider`-keyed e cada provedor futuro (Gmail, RF-22; contas Claude/OpenAI, RF-33) migra sua própria linha com sua própria migração — não há necessidade de coordenação central agora, e `core` não deveria conhecer detalhe de nenhum provedor específico (mesma fronteira que mantém `tasks` como único módulo "de dados" que os outros referenciam, ARCHITECTURE.md §2). Se um segundo provedor precisar de colunas incompatíveis, decidir consolidação nessa hora é mais barato que generalizar cedo demais agora |
| Escopo único `calendar.events` (nunca `calendar` completo) | Escopo `https://www.googleapis.com/auth/calendar` (acesso total, incluindo configurações e lista de calendários) | ADR-010 já fixa escopo mínimo por milestone; `calendar.events` cobre exatamente list/create/update de eventos do calendário `primary`, sem exposição de dado além do necessário — reduz o dano de um eventual vazamento do token ao estritamente necessário |
| Idempotência de `create_event` via `gcal_id` já gravado no `event` interno, sem tabela de deduplicação própria | Chave de idempotência separada (hash do payload da tool, ou UUID gerado pelo cliente antes da chamada) | O par item/evento interno já existe (FEAT-004) e já é o registro de que "esse compromisso foi criado"; gravar o `gcal_id` nele e checar antes de chamar o Google de novo reusa a mesma fonte de verdade, sem estrutura nova só para deduplicar uma tool que já é pouco frequente (compromisso criado por frase, não em alta cadência) |

(Nenhuma decisão nova de arquitetura de impacto duradouro além do ADR-010, já aceito antes desta implementação — o padrão de token cifrado com AES-256-GCM está fixado no SECURITY.md §4, não repetido aqui como ADR novo.)

## Impacto técnico

- **Banco:** migração nova em `modules/integrations/google-calendar/migrations` para `auth_tokens` (colunas descritas no Escopo, item 2). Nenhuma migração em `modules/tasks` — `events`/`jobs` já existem (FEAT-004) e são reusados sem alteração de schema.
- **API:** duas rotas HTTP novas, locais/administrativas, fora do webhook público — `GET /setup/google` (gera URL de consent) e `GET /setup/google/callback` (troca `code` por tokens). Nenhuma rota nova de uso diário; a leitura/escrita da agenda acontece só via serviço interno (chamado pelo briefing futuro e pela tool) e via tool `create_event` do brain.
- **Frontend:** nenhum — interface 100% WhatsApp; o setup OAuth é feito pelo navegador do dono uma única vez, não é tela de uso diário.
- **Permissões:** as rotas de setup não passam pelo filtro de JID do WhatsApp (não fazem parte do webhook) — são acessíveis só localmente/via túnel SSH, nunca publicadas atrás do Caddy nesta entrega (mesma lógica de borda do SECURITY.md §5: superfície administrativa não é exposta publicamente).
- **Áreas sensíveis tocadas:** sim — env vars novas (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_REDIRECT_URI`), tokens cifrados em repouso, chamada a serviço externo novo (Google OAuth2/Calendar API), rota HTTP nova. `security-auditor` é obrigatório no review desta feature (regra do CLAUDE.md e do próprio recorte da tarefa).

## Testes

Toda a suíte roda sem credenciais reais — o cliente Google é stubado (fake do `googleapis`/`google-auth-library`) em 100% dos testes; nenhum teste chama a API real do Google. A validação com credenciais reais é manual, listada em Como validar manualmente.

| Tipo | O que cobre |
|---|---|
| Unit — cifra/decifra (`token-cipher.ts`) | Round-trip (cifra e decifra devolve o texto original); chave errada falha a decifra (auth tag do GCM rejeita), nunca retorna dado corrompido; IV nunca reutilizado entre duas cifragens do mesmo valor. |
| Unit — refresh de token | Token com `expiry` vencido dispara refresh antes de qualquer chamada à API (cliente Google stubado); token ainda válido não dispara refresh desnecessário; refresh falho (stub simula erro do Google) propaga o erro para o chamador **e** dispara o alerta por e-mail (mockado) — nunca mascara a falha como sucesso silencioso. |
| Unit — mapeamento evento Google → event interno → cadeia | Evento do Calendar com horário e sem `event` interno correspondente gera `event` + cadeia completa (reusa `expandChain` da FEAT-004); evento já sincronizado (mesmo `gcal_id`) não duplica `event` nem cadeia numa segunda leitura; evento do Google sem horário (dia inteiro) não gera cadeia. |
| Integração — `create_event` (stub Google) | Tool cria evento no Google (stub) + `event` interno + cadeia completa numa única chamada; chamada repetida com o mesmo resultado de tool (simulando retry/reentrega) não duplica no stub do Google nem no banco interno — idempotência verificada no estado do SQLite. |
| Segurança/isolamento | Suite S (TESTING.md §3) estendida: token (`access_token`/`refresh_token`, cifrado ou não) nunca aparece em log, mesmo em `debug` — redação de log estendida para cobrir os campos novos; escopo solicitado na URL de consent é exatamente `calendar.events`, nunca escopo mais amplo (assertion sobre a URL gerada); valor de `access_token_cifrado`/`refresh_token_cifrado` no SQLite não é texto plano (assertion direta no arquivo do banco de teste). |

## Como validar manualmente

Pré-requisito do dono, feito uma única vez, fora do código: criar o app OAuth no Google Cloud Console, configurar a tela de consentimento como **External**, publicá-la como **"In Production"** (ADR-010) e preencher `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`/`TOKEN_ENCRYPTION_KEY` no `.env` real do host.

1. Com o sistema rodando, acessar `GET /setup/google` pelo navegador (local ou via túnel SSH) e completar o consent com a conta Google pessoal do dono.
2. Confirmar em `auth_tokens` (via inspeção do SQLite) que existe uma linha `provider = 'google_calendar'` com `access_token_cifrado`/`refresh_token_cifrado` — nenhum dos dois em texto plano.
3. Perguntar "o que tenho amanhã?" pelo WhatsApp: a resposta reflete a agenda real do Google Calendar do dia seguinte.
4. Enviar "marca reunião sexta 10h": confirmação em 1 linha; o evento aparece no Google Calendar do dono **e** a cadeia de lembretes (véspera/manhã/preparo) é gerada, verificável pelo disparo dos alertas correspondentes.
5. Repetir o mesmo comando de captura que geraria o mesmo evento (ex. reenvio acidental da mesma mensagem): nenhum evento duplicado aparece no Google Calendar nem uma segunda cadeia é criada.

---

## Entrega

- **O que foi feito:** OAuth Google via `googleapis`/`google-auth-library` (`GoogleOAuthClient`), cifra AES-256-GCM de `auth_tokens` (`TokenCipher`, formato armazenado `iv:authTag:ciphertext`), refresh automático antes de qualquer chamada com alerta por e-mail em falha, rotas de setup (`GET /setup/google` e `/setup/google/callback`) e `listTodayAndSync` (leitura sob demanda do dia + sincronização mínima com `event`/cadeia via `EventService`) — itens 1, 2, 3 e 5 da spec. O item 4 (escrita) seguiu a **opção A da ADR-019** (caminho determinístico, sem loop de tool-use do brain — a tool fica para a FEAT-006): `GoogleCalendarService.createRemoteEvent` foi adicionado ao mesmo serviço que expõe `listTodayAndSync`, e o `CaptureService` passou a chamar o evento remoto logo após criar o `event` interno de um `compromisso` com data/hora resolvida, gravando o `gcal_id` retornado via `EventService.setGcalId`. Ausência de tokens ou qualquer falha na chamada ao Google é capturada e logada em `warn` — a captura nunca falha por causa do Calendar, e o dono nunca vê erro relacionado a isso.
- **Correções do review aplicadas antes do merge (commit `fix: aplica correcoes do review da FEAT-005`):**
  - A migração `005_tasks_items_origin_google_calendar.ts` fazia `INSERT INTO items_new SELECT * FROM items` — corrigido para listar as colunas explicitamente dos dois lados. As migrações 002/003 já tinham adicionado `source_message_id`/`source_item_index` via `ALTER TABLE ADD COLUMN`, que anexa a coluna ao final da tabela viva; a ordem real diverge da ordem declarada em `items_new`, então o `SELECT *` posicional copiava valor para a coluna errada sem erro do SQLite — corrompia os campos de idempotência do ADR-018 em qualquer base com itens já capturados. É o bug de maior gravidade encontrado no review: corrupção silenciosa de dado em produção, não só um risco teórico.
  - Log de refresh de token OAuth logava o payload inteiro da resposta do Google em `debug` — passou a logar só o resultado (sucesso/falha) e o `provider`, nunca `access_token`/`refresh_token`/`client_secret`. Coberto por `tests/security/google-calendar-secrets.test.ts`.
  - `infra/Caddyfile` só filtrava `/webhook/evolution*` e `/health`; qualquer outro path (incluindo `/setup/google*`) passava pelo `reverse_proxy` sem matcher. Corrigido para responder `404` a tudo fora dessas duas rotas — `/setup/*` fica alcançável só localmente/via túnel SSH, nunca pela internet, mesmo com o domínio publicado.
  - Sincronização de leitura (`listTodayAndSync`) passou a gravar `event` + `gcal_id` dentro de uma transação, e a migração `006_tasks_events_gcal_id_unique.ts` criou um índice único parcial (`WHERE gcal_id IS NOT NULL`) em `events.gcal_id` — sem os dois, um re-sync concorrente ou um retry após crash no meio da escrita podia duplicar o `event` do mesmo compromisso do Google (lembretes em dobro). A violação de unicidade sob corrida é tratada como "evento já existe, pula" (não propaga erro).
  - Fluxo OAuth ganhou `state` de uso único gerado em `buildConsentUrl` (`randomBytes(32)` em base64url) e conferido em `completeSetup` por comparação em tempo constante (mesmo padrão do filtro de JID, SECURITY.md §2) — mitiga CSRF/injeção de código no callback. Callback sem `state` ou com valor divergente é rejeitado com `InvalidOAuthStateError` antes de qualquer troca de código.
  - `EventsRepository.findByGcalId` passou a filtrar `status = 'ativo'` — antes também encontrava evento cancelado, o que fazia a sincronização tratar um compromisso já cancelado (localmente) como "já sincronizado" e nunca recriá-lo mesmo que o Google ainda o mostrasse.
- **PRs:** #21 (a abrir nesta entrega).
- **Migrações:**
  - `modules/integrations/google-calendar/migrations/001_google_calendar_auth_tokens.ts` — tabela `auth_tokens` (`provider` PK, tokens cifrados, `expiry`, `scopes`, `updated_at`).
  - `modules/tasks/migrations/005_tasks_items_origin_google_calendar.ts` — adiciona `google_calendar` ao `CHECK` de `items.origin`, recriando a tabela com cópia explícita de colunas (SQLite não tem `ALTER ... DROP CONSTRAINT`; ver correção do review acima).
  - `modules/tasks/migrations/006_tasks_events_gcal_id_unique.ts` — índice único parcial em `events.gcal_id` (`WHERE gcal_id IS NOT NULL`).
  - As três com `down` testado.
- **Pendências/débitos:**
  - A tool `create_event` como `ToolDefinition` do registry (o brain decidindo chamar) fica para a FEAT-006, conforme ADR-019 — não é omissão, é escopo explicitamente adiado.
  - Duração do evento remoto: quando a triagem só resolve o horário de início (caso comum de "dentista quinta 16h"), o evento no Google é criado com 1h de duração fixa (`DEFAULT_EVENT_DURATION_MS` em `capture-service.ts`) — não há negociação de duração pela frase nesta entrega; a API do Google exige um fim explícito e o `event` interno não teria um se a captura não resolver.
  - `state` anti-CSRF do fluxo OAuth vive em memória do processo (`GoogleCalendarService.pendingOAuthState`), não em tabela — coerente com o setup ser operação local única e síncrona (o dono gera a URL e completa o callback na mesma execução do processo), mas um restart do brain entre `GET /setup/google` e o callback invalida o `state` pendente e obriga reiniciar o setup do zero. Aceitável para uma rotina manual de poucos minutos; documentado aqui para não ser confundido com bug se acontecer.
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `TOKEN_ENCRYPTION_KEY` já estavam no `.env.example` (adicionados numa rodada anterior); faltava `GOOGLE_REDIRECT_URI`, adicionada nesta sessão de documentação — as 4 chaves da feature estão no arquivo.
- **Aprendizados:**
  - `db.transaction()` do better-sqlite3 é síncrono — a chamada ao Google (I/O de rede) não pode viver dentro da mesma transação que grava item+event+cadeia. `captureItems` ficou `async`: a transação síncrona persiste item/event/cadeia primeiro; a criação do evento remoto e a gravação do `gcal_id` acontecem depois, fora da transação, num update separado e idempotente (`setGcalId`).
  - A granularidade de idempotência do ADR-018 (por `source_item_index`) já resolve a duplicação do evento remoto de graça: um item já persistido é pulado inteiro no reprocessamento, então `createRemoteEvent` nunca é chamado de novo para ele. Isso significa que, no caso raro de o processo crashar exatamente entre "event interno criado" e "evento remoto criado com sucesso", o evento remoto simplesmente não é tentado de novo automaticamente — aceito como parte da mesma degradação graciosa (o compromisso já existe e já tem cadeia; falta só o espelho no Google).
  - `GoogleCalendarService.createRemoteEvent` e `listTodayAndSync` dividem o mesmo `getValidAccessToken` privado — qualquer chamador novo (a tool da FEAT-006, por exemplo) herda de graça o refresh automático e o alerta de falha, sem reimplementar nada.
  - O review encontrou 4 achados bloqueantes (corrupção de dado na migração 005, log de refresh com dado sensível, `/setup/*` exposto pelo Caddy, duplicação de evento sob corrida sem transação/índice único) e mais achados importantes/sugestões de menor impacto (state anti-CSRF ausente, `findByGcalId` incluindo cancelado) — todos corrigidos antes do merge, nenhum adiado para depois.
