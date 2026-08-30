# FEAT-004 — Eventos e cadeias de lembrete contra cegueira temporal

**Status:** entregue · **Issue:** #14 · **Branch:** `feature/FEAT-004-cadeias-lembrete` · **Data:** 2026-08-30

## Contexto e objetivo

A FEAT-002 entregou o lembrete pontual: item com data/hora vira um único job `reminder` que dispara no horário exato. Isso resolve "não esquecer que existe", mas não resolve a cegueira temporal que motiva o RF-04 — para quem tem TDAH, um alarme único no horário do compromisso chega tarde demais. Falta a noção de "quanto falta" e do tempo de preparo/deslocamento antes de sair de casa. Esta feature atende RF-04 do PRD.

A tese é simples: compromisso com hora não deveria gerar um lembrete, deveria gerar uma **cadeia** — véspera à noite, manhã do dia e "hora de se preparar/sair" descontando o deslocamento — cada etapa formulada como tempo restante, nunca só horário absoluto (PRD §1, tese 2; PRD §10). O gerador que expande um compromisso nessa cadeia é código puro, sem LLM (ADR-006): o texto de cada alerta é template determinístico, e o disparo reaproveita o scheduler durável já existente (ADR-004) — nenhuma tabela nova de agendamento, nenhum cron em memória.

O recorte técnico decidido aqui: a entidade `events` nasce **dentro de `modules/tasks`**, não em `modules/chains` isolado (ver Decisões tomadas). O gerador de cadeia — a função pura que, dado um evento e as settings, produz a lista de reminders — vive em `modules/chains`, que é o módulo previsto no ARCHITECTURE.md §2 para essa responsabilidade e não tinha razão de existir antes desta feature. `events` e o gerador de cadeia moram em módulos diferentes pela mesma lógica que já separa `tasks` de `capture`: uma coisa é o dado (o compromisso existe, tem horário, pertence ao task-store), outra é a regra de negócio que decide em que cadeia ele vira (quantos alertas, quando, com que antecedência) — a segunda muda com frequência (settings, novos tipos de cadeia como boletos no M3) sem que a primeira precise mudar junto.

Esta é a primeira feature em que um item do task-store passa a ter uma vida "fora dele mesmo": criar um `compromisso` com data/hora deixa de ser só uma linha em `items` com um job avulso — passa a existir um `event` correspondente, com sua própria cadeia de jobs. Cancelar ou reagendar o compromisso precisa propagar para essa cadeia; é o primeiro lugar do produto onde "editar o dado" e "editar a proatividade que ele gerou" são operações distintas que precisam ficar consistentes uma com a outra.

## Escopo

1. **Entidade `events` em `modules/tasks`** (migração própria, prefixo `tasks_`):
   - Colunas: `id`, `item_id` (FK para o compromisso de origem), `title`, `start_at` (TZ `America/Sao_Paulo`), `end_at` (opcional), `local` (opcional), `deslocamento_min` (default vindo de settings no momento da criação, ajustável depois), `cadeia_gerada` (bool), `status` (`ativo|cancelado`), `created_at`/`updated_at`.
   - Serviço de domínio (`EventService`) que cria o evento a partir de um item tipo `compromisso` com `dueAt` resolvido, cancela (lógico, nunca `DELETE` — ADR-009) quando o item é dropado, e regenera quando a data muda.
   - `google Calendar` (`gcal_id` do ER do ARCHITECTURE.md §3) **não** é preenchido nesta feature — fica nulo/ausente; é FEAT-005. O campo existe no ER geral, mas a fonte da verdade da agenda aqui é só interna.

2. **`modules/chains` (novo módulo) — gerador determinístico de cadeia:**
   - Função pura `expandChain(event, settings) => ChainReminder[]` em `modules/chains/domain`, sem I/O, sem LLM (ADR-006): dado um evento e as antecedências configuradas, devolve a lista de reminders da cadeia com `tipoCadeia` (`vespera|manha|preparo`) e `fireAt` calculado em `America/Sao_Paulo`.
   - Três etapas por padrão: véspera à noite (default configurável, ex. 20h do dia anterior), manhã do dia (default configurável, ex. 8h), e "hora de se preparar/sair" (`start_at` menos `deslocamento_min` menos uma margem de preparo configurável).
   - Reminder cuja etapa cairia no passado (ex. compromisso marcado às 10h de hoje não gera "véspera" nem "manhã" retroativas) é omitido da lista — a cadeia nunca agenda um alerta para um horário que já passou.
   - Cada reminder da lista vira um job `type: 'reminder'` na tabela `jobs` já existente (reusa o `JobRepository`/scheduler da FEAT-001/ADR-004) com `payload` carregando `eventId`, `itemId`, `tipoCadeia` e os dados que o template precisa (título, `start_at`, `deslocamento_min`).
   - Antecedências (horário da véspera, horário da manhã, margem de preparo) e `deslocamento_min` default são chaves novas em `settings`, com defaults sensatos — nada hard-coded fora do módulo.

3. **Templates determinísticos da cadeia (sem LLM no disparo):**
   - Handler do job `reminder` (já existente, `modules/capture/reminder-job.ts`) passa a reconhecer `tipoCadeia` no payload e escolher o template certo; lembrete pontual sem `tipoCadeia` continua com o texto atual, sem mudança.
   - Véspera e manhã: mencionam o compromisso e o tempo até ele de forma natural ("amanhã você tem X", "hoje mais tarde: X"), tom RSD-safe.
   - Alerta de "hora de sair": formulado como **tempo restante** ("faltam 40 min pra sair"), nunca só o horário absoluto — é o requisito central do RF-04.
   - Banco de variações estático por tipo de etapa (mesmo padrão da FEAT-002 para os templates de captura/conclusão) — testável deterministicamente.

4. **Cancelamento e regeneração:**
   - Compromisso dropado (deleção lógica do item, `status = dropada`) cancela o evento (`status = cancelado`) e todos os jobs pendentes da cadeia associada (marcados, nunca apagados — jobs já `confirmed`/`sent` no passado permanecem como histórico).
   - Mudança de data do compromisso (reagendamento) marca a cadeia antiga como cancelada e gera uma cadeia nova a partir da nova data — nunca edita `fire_at` de um job existente in-place, para manter o rastro de auditoria (job → outbox → 2xx → `delivered_at`) coerente com o ARCHITECTURE.md §6.

5. **Ligação com a captura:**
   - Em `capture-service.ts`, quando a triagem classifica um item como `compromisso` **e** `dueExpression` resolve para uma data/hora válida, em vez de só criar o job `reminder` avulso da FEAT-002, o serviço cria o `event` correspondente e chama `expandChain` para gerar a cadeia inteira.
   - Item tipo `compromisso` sem hora resolvida (`dueExpressionUnresolved`) e qualquer outro tipo (`tarefa`, `ideia`, `lembrete`, `nota`) seguem exatamente como estão hoje — lembrete pontual ou nenhum job, sem mudança de comportamento.
   - A confirmação de captura (1 linha, sem pergunta de estrutura) não muda de forma — o usuário não vê nenhuma diferença na resposta por trás existir uma cadeia em vez de um job avulso.

## Fora de escopo

- Google Calendar (RF-12, FEAT-005) — `events` aqui é fonte interna; sincronização bidirecional e criação via `create_event` ficam para quando essa feature existir.
- Briefing matinal (RF-05, `modules/rituals`, FEAT-006) — a agenda do dia não é lida por nenhum ritual ainda; esta feature só garante que o evento existe e dispara sua própria cadeia.
- Checklist de preparação (`prep_itens`, RF-29, M3) — a coluna existe no ER geral do ARCHITECTURE.md §3, não é criada aqui.
- Boletos e cadeia de vencimento (RF-25, M3) — o gerador desta feature cobre só compromisso; cadeia de pagamento é caso novo de domínio no mesmo módulo `chains`, quando M3 chegar (ARCHITECTURE.md §4 já prevê isso).
- Reagendamento por comando de conversa livre ("muda pra sábado") — o disparo de regeneração cobre o caminho de dado mudar (via serviço), não a interpretação de linguagem natural para decidir a nova data; isso é RF-07/executor determinístico ou RF-18/M2, conforme o padrão de fala.
- Cobrança de confirmação do compromisso ("foi?", RF-08) — é `modules/nudges`, feature futura; a cadeia desta feature só avisa, não verifica.
- Proatividade adaptativa dos horários da cadeia por `patterns` (RF-24, M3) — os horários de véspera/manhã vêm de settings fixas, não de aprendizado de comportamento.

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| `events` vive em `modules/tasks` (junto com `items`); só o **gerador de cadeia** (função pura + orquestração de jobs) vive em `modules/chains` | (a) `events` também dentro de `modules/chains`, já que o ARCHITECTURE.md §2 descreve `chains` como dono da "expansão de compromissos"; (b) `events` como módulo próprio (`modules/events`) | `events` é dado de domínio do task-store (compromisso com horário, sujeito às mesmas regras de deleção lógica e mesma FK de `item_id` que `reminders` já tem no ER) — coerente com a regra do ARCHITECTURE.md §2 de que `tasks` é "o único módulo de dados que os outros referenciam". `chains` reage a `events` (via serviço público de `tasks`) exatamente como `capture` reage a `items` hoje; forçar `events` para dentro de `chains` replicaria a fronteira artificial que a FEAT-002 já evitou ao não criar `commands` separado |
| Reagendamento cancela a cadeia antiga e gera uma nova, em vez de recalcular `fire_at` dos jobs existentes in-place | Atualizar `fire_at`/`payload` dos jobs pendentes da cadeia atual para os novos horários | Editar job in-place quebra o rastro de auditoria do ARCHITECTURE.md §6 (job → outbox → 2xx → `delivered_at`) se algum já estiver `running`/`confirmed` no meio da transição; cancelar e recriar mantém histórico imutável e usa o mesmo caminho de código do cancelamento por drop (menos ramificação) |
| Etapa da cadeia cujo horário já passou é omitida da lista (não gerada, não gerada-e-cancelada) | Gerar o job mesmo no passado e deixar o scheduler descartá-lo por "vencido demais"; gerar e já marcar `failed` | O scheduler (ADR-004) não tem noção de "vencido demais para valer a pena" — ele existe para garantir que vencido dispare (catch-up). Ensinar essa exceção ao scheduler para um caso de uso específico de `chains` violaria a regra de que módulo não deveria exigir mudança em `core/scheduler` para um caso de negócio seu; mais simples o próprio `expandChain` nunca produzir a etapa |

(Nenhuma decisão nova de arquitetura de impacto duradouro fora das acima — o gerador puro sem LLM já está fixado no ADR-006, o scheduler reusado sem alteração no ADR-004, a deleção lógica no ADR-009.)

## Impacto técnico

- **Banco:** migração nova em `modules/tasks/migrations` para a tabela `events` (colunas descritas no Escopo, item 1). Nenhuma migração em `core/` — `jobs` já existe (FEAT-001) e ganha só um novo formato de `payload` para `type: 'reminder'` (campo opcional `tipoCadeia`/`eventId`), sem alteração de schema. Sem dado de cliente, sistema single-user; sem migração de dados existentes.
- **API:** nenhuma rota HTTP nova — segue tudo por `POST /webhook/evolution` (captura) e pelo scheduler interno (disparo).
- **Frontend:** nenhum — interface 100% WhatsApp.
- **Permissões:** sem mudança — sistema single-user, filtro de JID já existente.
- **Áreas sensíveis tocadas:** nenhuma nova (sem env var, sem chamada a serviço externo novo). Diff não deveria disparar `security-auditor` por critério automático, mas toca o caminho crítico de lembretes (ADR-004/ADR-006) — revisão do `code-reviewer` cobre a aderência aos dois ADRs.

## Testes

| Tipo | O que cobre |
|---|---|
| Unit — `modules/chains` (gerador) | `expandChain` gera véspera/manhã/preparo com os horários de settings aplicados; desconto de `deslocamento_min` e margem de preparo no cálculo do alerta de saída; etapa cujo horário cairia no passado é omitida (compromisso hoje à tarde não gera véspera nem manhã); antecedências customizadas em settings substituem os defaults; TZ `America/Sao_Paulo` explícito cruzando meia-noite (compromisso de manhã cedo com véspera caindo no dia anterior) e virada de mês. |
| Unit — cancelamento/regeneração | Drop do item cancela o evento e todos os jobs pendentes da cadeia (jobs já `confirmed` no passado preservados); reagendamento (mudança de `dueAt`) cancela a cadeia antiga por completo e cria uma nova coerente com a nova data; item que nunca teve evento (compromisso sem hora resolvida) não gera efeito nenhum ao ser dropado/editado. |
| Unit — templates da cadeia | Alerta de saída sempre contém tempo restante formatado ("faltam N min"), nunca só horário absoluto; véspera/manhã com banco de variações estático; template pontual (sem `tipoCadeia`) inalterado desde a FEAT-002. |
| Integração | Captura "dentista sexta 16h" → item `compromisso` + `event` criado + exatamente 3 jobs na cadeia (véspera/manhã/preparo) com `fire_at` corretos, numa única confirmação de 1 linha no outbox; drop do compromisso via comando ("dropa") → jobs pendentes da cadeia cancelados, verificado no estado do SQLite; disparo de cada tipo de reminder da cadeia (avanço de tempo simulado) → mensagem correta no outbox por template, sem nenhuma chamada ao LLM no caminho do disparo (assertion de que o client não foi invocado). |
| Segurança/isolamento | Nenhum cenário novo da suite S1..S10 (TESTING.md §3) — esta feature não introduz superfície de entrada nova; suite existente continua verde com o payload de job estendido. |
| Suite de TOM (`tests/tone/`) | Mensagens de véspera, manhã e "hora de sair" passam pelos padrões proibidos do TESTING.md §4.1 (nenhum tom de fiscal, nenhuma menção a adiamento ou histórico); alerta de saída nunca soa como cobrança, é aviso neutro com tempo restante. |
| E2E (fluxo de negócio) | Fluxo 3 do PRD §6 completo pela primeira vez: compromisso criado por frase → cadeia expandida em `jobs` → scheduler dispara véspera/manhã/preparo na ordem certa com avanço de tempo simulado → confirmação pós-2xx de cada um no outbox. |

## Como validar manualmente

Com o sistema rodando e `ANTHROPIC_API_KEY` real preenchida:

1. Enviar "marca reunião amanhã 15h, é longe" pelo número configurado em `OWNER_WHATSAPP_JID`: confirmação em 1 linha, sem nenhuma pergunta de estrutura.
2. Simular (ou esperar) o horário da véspera configurado em settings: alerta chega mencionando o compromisso do dia seguinte.
3. Simular o horário da manhã configurado: alerta chega lembrando do compromisso de hoje.
4. Simular o horário de saída (calculado a partir do deslocamento): alerta chega no formato "faltam N min pra sair", nunca só o horário da reunião.
5. Enviar "dropa" referente a esse compromisso antes do horário de saída: nenhum alerta restante da cadeia chega.

---

## Entrega

- **O que foi feito:** todo o escopo da spec entrou, sem desvio de comportamento. Entidade `events` em `modules/tasks` (migração `tasks_004_events`) com `EventsRepository`/`EventService` — deleção sempre lógica (`status = cancelado`), `gcal_id` nulo até a FEAT-005. Módulo novo `modules/chains` com o gerador puro `expandChain` (`modules/chains/domain/expand-chain.ts`): dado um evento e as antecedências de `settings`, devolve véspera/manhã/preparo já resolvidos em `America/Sao_Paulo`, descartando qualquer candidato cujo `fireAt` caia no passado **ou** no próprio horário do compromisso ou depois dele — essa segunda guarda (`fireAt >= startAt`) não estava na primeira versão e foi achado do review: com `manhaHour` tardio e compromisso de manhã cedo, o alerta "de manhã" podia nascer depois do próprio compromisso, o oposto do que RF-04 pede. Templates determinísticos por etapa em `modules/chains/domain/chain-templates.ts` (mesmo padrão de banco estático de variação da FEAT-002), com o alerta de saída sempre formulado como tempo restante ("faltam N min pra sair") recalculado no momento do disparo pelo handler (`modules/capture/reminder-job.ts`), nunca congelado na criação do job. `capture-service.ts` cria `event` + cadeia inteira quando o item é `compromisso` com `dueExpression` resolvida; qualquer outro caso (compromisso sem hora, ou outro tipo) segue exatamente como a FEAT-002 deixou.

  Dois pontos merecem destaque por não estarem óbvios lendo só o escopo acima:

  1. **Cancelamento e regeneração passam pelo `EventBus`, não por chamada direta — primeiro uso real do bus desde que ele foi criado na FEAT-001 (ADR-011).** `ItemService.drop`/`snoozeByText` publicam `item.dropped`/`item.rescheduled`; `modules/chains` assina os dois em `buildChainsModule` (manifest.ts) e reage cancelando o evento ativo do item e os jobs `reminder` ainda `pending` da cadeia associada (`ChainService.onItemDropped`/`onItemRescheduled` em `chain-service.ts`). É o primeiro caso em que `tasks` precisa avisar um módulo que não conhece, e o bus é exatamente o mecanismo que o ADR-011 previu pra isso — `tasks` continua sem importar `chains`. O `EventBus` (`src/core/bus/event-bus.ts`) ganhou isolamento de erro por assinante nesta feature: cada `handler` roda em `try/catch` próprio dentro do `emit`, com o erro só logado (`EventBusLogger`), nunca propagado — um handler de `chains` que lançasse não podia impedir outros assinantes futuros de rodar. Não havia essa proteção antes porque não havia mais de um assinante real para testar.

  2. **Cancelamento de cadeia usa o status `cancelado` novo em `jobs`, não `failed`.** A tabela `jobs` (FEAT-001) tinha `CHECK (status IN ('pending','running','sent','confirmed','failed'))`; ampliar esse vocabulário exigiu migração própria (`007_core_jobs_cancelado_status`, em `core/db/migrations`, não em `tasks` — a tabela é de `core/scheduler`) porque SQLite não altera `CHECK` de coluna existente: a migração recria a tabela (cria `jobs_new`, copia dados, dropa a antiga, renomeia, recria o índice `jobs_due_lookup`). O motivo de existir: a métrica de entrega de 99,5% do PRD (ARCHITECTURE.md §6) deriva do status dos jobs — se o cancelamento de rotina (drop ou reagendamento de compromisso) marcasse os jobs pendentes como `failed`, cada "dropa"/reagendamento do dia inflaria a métrica de falha por um comportamento normal do produto, não um incidente de entrega real. `down` é reversível e documentado como mapeamento com perda: como `cancelado` não existe no schema anterior, jobs nesse status viram `failed` no downgrade (não há como preservar o rastro sem a coluna) — é o melhor mapeamento reversível disponível, registrado em comentário na própria migração.

- **Desvios de escopo/arquitetura registrados acima:** nenhum de comportamento. A guarda extra em `expandChain` (item 1) é refinamento do próprio requisito da spec ("etapa que cairia no passado é omitida"), não mudança de escopo — o review só tornou explícito um caso limite que a primeira versão não cobria.
- **PRs:** feature implementada na branch `feature/FEAT-004-cadeias-lembrete` (commits `e3faa93` spec, `a243cbb` implementação, `70da275` correções do review); PR para `main` aberto nesta entrega.
- **Migrações:** `tasks_004_events` (tabela `events`, em `modules/tasks/migrations`); `007_core_jobs_cancelado_status` (amplia `CHECK` de `jobs.status` para incluir `cancelado`, em `core/db/migrations`, com `down` que remapeia `cancelado` → `failed`).
- **Pendências/débitos:** nenhum `TODO` novo aberto nesta feature. Google Calendar, briefing matinal, checklist de preparação, cadeia de boletos, reagendamento por linguagem livre, cobrança de confirmação e proatividade adaptativa dos horários seguem mapeados em "Fora de escopo" — não são débito desta entrega.
- **Aprendizados:**
  - Quem for adicionar um segundo assinante a qualquer evento do bus deve saber que o isolamento de erro (`EventBus`, item 1 acima) só existe desde esta feature — antes dela, um handler que lançasse quebraria o `emit` inteiro sem nenhum teste cobrindo esse caso, porque só havia zero assinantes.
  - `JobRepository.findPendingByType` (novo, `core/scheduler/job-repository.ts`) filtra por `type` usando o índice `jobs_due_lookup` (`status, next_run_at`) e resolve o vínculo com o evento em código, lendo `eventId` do `payload` — não existe índice sobre o `payload` JSON; se o volume de jobs `reminder` pendentes crescer muito, essa varredura é o primeiro lugar a olhar antes de mexer no schema de `jobs` de novo.
  - Review desta entrega teve 2 achados importantes e 2 sugestões, todos corrigidos antes do merge (nenhum refutado); `security-auditor` não foi acionado porque o diff não toca área sensível (sem env var nova, sem chamada a serviço externo novo) — só o `code-reviewer` revisou aderência ao ADR-004/ADR-006/ADR-011.
