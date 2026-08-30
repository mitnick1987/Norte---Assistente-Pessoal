# FEAT-008 — Observabilidade completa e monitor de custo

**Status:** rascunho · **Issue:** #18 · **Branch:** `feature/FEAT-008-observabilidade-custo` · **Data:** 2026-08-30

## Contexto e objetivo

Norte roda sozinho numa VPS, sem ninguém olhando dashboard. Se a sessão do WhatsApp cai, se o processo inteiro morre, se o custo de API dispara por uma regressão de cache — nada disso é visível a menos que o próprio sistema grite por um canal que não depende do WhatsApp estar de pé. O PRD trata isso como não negociável: "erro que ninguém vê não existe até virar incidente, e aqui incidente significa lembrete perdido" (ARCHITECTURE.md §6).

A FEAT-001 já colocou o esqueleto: `ConnectionWatchdog` registra estado de `CONNECTION_UPDATE`, `/health` existe, e um `FailureAlerter` (interface em `core/outbox/alerter.ts`) já é chamado por outbox (retries esgotados, ritual-âncora represado) e pelo refresh OAuth do Google Calendar (FEAT-005). Mas a única implementação, `EmailAlerter` (`src/infra-ops/email-alerter.ts`), **só loga em `error`** — não existe transporte de e-mail de verdade. Ou seja: hoje, se a sessão cai às 3h da manhã, o log registra o problema e ninguém é avisado. Essa é a lacuna que RF-13 (watchdog, dead man's switch, alertas) e RF-15 (monitor de custo) fecham, e é deliberadamente a última feature do M1 — hardening depende de tudo que veio antes (task-store, captura, lembretes, Calendar, rituais, loop/higiene) já existir para ter o que observar.

Atende RF-13 (watchdog de sessão, dead man's switch externo, alertas por e-mail, disco), RF-15 (monitor de custo de API) e fecha o gap de observabilidade honesta do `/health` (BUG-002, issue #3). Não fecha BUG-001 nem REF-001 — ver Decisões.

## Escopo

1. **Transporte de e-mail real no `EmailAlerter` (RF-13):**
   - `EmailAlerter` passa a enviar e-mail de fato, via SMTP (`SMTP_URL`) ou Resend (`RESEND_API_KEY`) + `ALERT_EMAIL` — ambas já previstas no `.env.example` desde a fundação, nenhuma env nova.
   - Canal decididamente fora do WhatsApp: se a sessão inteira ou o VPS caírem, o e-mail ainda sai (ou, no limite, o dead man's switch externo cobre esse caso — item 2).
   - Os três call-sites existentes (`alertDeliveryExhausted`, `alertRefreshFailure`, `alertAnchorRitualCapped`, hoje só logando) passam a acionar o envio real, sem mudar a interface `FailureAlerter` nem os pontos de chamada em `outbox/processor.ts` e `google-calendar-service.ts`.
   - Degradação: se o envio falhar (SMTP fora, Resend com erro, credencial inválida), loga em `error` — não há canal acima do e-mail para escalar essa falha específica.
   - Anti-flood: mesmo alerta (mesma chave lógica — tipo + identificador do recurso) não dispara de novo dentro de uma janela configurável em settings; sem isso, uma sessão caída por horas manda um e-mail por tentativa de reconexão.

2. **Dead man's switch externo — Healthchecks.io (RF-13):**
   - Ping HTTP para `HEALTHCHECKS_PING_URL` (já prevista no `.env.example`) a cada 5 minutos, via job durável do scheduler (ADR-004) — nunca timer solto em memória.
   - Ping só sai se os subsistemas essenciais estão de fato vivos (DB respondendo, scheduler com tick recente, sessão WhatsApp conectada); pingar "morto" anularia o propósito do dead man's switch. A checagem reusa a mesma lógica de saúde do item 4.
   - Se o processo inteiro cai (VPS reiniciando, container derrubado), o ping simplesmente para de chegar — o próprio Healthchecks.io detecta a ausência e alerta por e-mail, sem depender de nada dentro do Norte estar funcionando.

3. **Watchdog de sessão WhatsApp → alerta real (RF-13):**
   - `ConnectionWatchdog` (FEAT-001) já registra estado de `CONNECTION_UPDATE`/`QRCODE_UPDATED`. Esta entrega conecta esse estado ao `FailureAlerter`: sessão caída ou pedido de novo QR dispara e-mail com instrução de re-scan, em até 5 minutos da mudança de estado.
   - Sujeito ao mesmo anti-flood do item 1 — reconexões repetidas não geram e-mail repetido.

4. **`/health` honesto (fecha BUG-002, issue #3):**
   - Hoje `health-route.ts` reporta `status: 'ok'` sempre que o DB responde, ignorando scheduler parado ou sessão desconectada — achado confirmado do review da FEAT-001.
   - Passa a reportar `degraded` (HTTP 503 e/ou campo explícito) quando qualquer subsistema essencial está fora: DB inacessível, scheduler sem tick recente (janela configurável), sessão WhatsApp fora do estado conectado.
   - A mesma função de avaliação de saúde alimenta o gate do item 2 (dead man's switch) — uma única fonte de verdade sobre "o sistema está vivo o bastante para pingar/responder ok".

5. **Monitor de custo de API (RF-15):**
   - A partir de `tokens_in`/`tokens_out`/`cache_read` já gravados em `messages` (FEAT-002/FEAT-006), calcula projeção de custo mensal.
   - Preços de Sonnet 5 e Haiku 4.5 como settings (não fixados em ADR-007, que deliberadamente não cravou valores de tabela de preço em código) — evita reabrir código quando o preço mudar (ex.: fim do preço introdutório do Sonnet em 31/08/2026).
   - Alerta por e-mail quando a projeção mensal passa de US$25 (settings), sujeito ao mesmo anti-flood.
   - Alarme (e-mail, prioridade mais alta que o alerta de custo) quando `cache_read_input_tokens = 0` em chamadas repetidas ao Sonnet — sinal direto de regressão de prompt caching, que pode multiplicar custo em 5–10x silenciosamente (ADR-007).
   - Resumo de custo (tokens por modelo, projeção, taxa de cache hit) sai em log estruturado; não há relatório/dashboard nesta entrega (ver Fora de escopo).

6. **Alerta de disco (RF-13, best-effort):**
   - Se viável sem complexidade desproporcional dentro do container: checagem de uso de disco (`>85%` dispara alerta, mesmo canal/anti-flood dos demais).
   - Ver Decisões para o que de fato foi viável e o que ficou registrado como não feito.

## Fora de escopo

- **Dashboards visuais / UI de administração:** M3, junto com qualquer superfície visual do produto (o produto é 100% conversacional no WhatsApp na v1 — ARCHITECTURE.md).
- **Métricas Prometheus/Grafana ou qualquer stack de observabilidade dedicada:** over-engineering para um sistema single-user com um único operador (o dono) — o par log estruturado + alerta por e-mail + dead man's switch externo cobre o que o produto precisa nesta escala. Reabrir só se o produto deixar de ser single-user.
- **Tracing distribuído:** não há múltiplos serviços/instâncias que justifiquem correlacionar spans entre processos — o correlation-id em log estruturado (já existente) já cobre o rastro dentro de um processo.
- **BUG-001 (issue #2, primeiro retry do outbox espera ~2min):** avaliado como fora do escopo desta entrega — não é bug de observabilidade/custo, é do caminho de backoff do outbox (FEAT-001). Decisão registrada abaixo.
- **REF-001 (issue #4, status `sent` não usado no CHECK de `jobs`):** avaliado e não entrou — ver Decisões.

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| Preços de Sonnet 5/Haiku 4.5 ficam em settings, não hard-coded | Constantes no código, atualizadas a cada mudança de tabela de preço da Anthropic | ADR-007 já orça no "preço cheio pós-31/08/2026" sem cravar o valor em nenhum artefato versionado — settings evita um deploy só para atualizar um número que muda por decisão de terceiro (Anthropic), e mantém o cálculo de projeção auditável/ajustável sem tocar em código |
| Dead man's switch só pinga quando os 3 subsistemas essenciais (DB, scheduler, sessão) estão de fato saudáveis, reusando a mesma função de avaliação do `/health` | Pingar sempre que o processo está de pé, independente do estado dos subsistemas | Pingar "vivo" com o scheduler parado ou a sessão caída seria pior que não ter dead man's switch: dá falsa sensação de segurança justamente no cenário que o RF-13 existe para pegar. Uma função única de avaliação de saúde evita as duas implementações (rota HTTP e job de ping) divergirem sobre o que "saudável" significa |
| BUG-001 (backoff do outbox) fica de fora desta entrega | Corrigir junto por estar "no espírito de hardening" | É bug de comportamento do outbox (FEAT-001), não de observabilidade/custo — misturar teria ampliado o escopo e o raio de teste desta entrega sem relação com RF-13/RF-15. Fica registrado como pendência aberta (issue #2 permanece aberta) para um fix dedicado |
| REF-001 (remover `sent` do CHECK de `jobs`) fica de fora | Remover já que é "trivial" | A migração `003_core_jobs` citada na issue não tem o `CHECK` de vocabulário fechado que a issue presumia (achado equivalente já registrado na Entrega da FEAT-007: `jobs.type` não tem `CHECK`) — abrir a issue #4 concretamente é reavaliar a premissa dela antes de qualquer migração, o que é trabalho de investigação de refactor, não hardening de observabilidade. Fica para um REF dedicado que primeiro confirme o que existe hoje no schema |
| Alerta de disco: best-effort, checagem simples de uso do filesystem do container, sem biblioteca dedicada | Métrica via `df`/syscall nativo do SO, ou pular o item inteiro | Checagem de disco dentro de um container é normalmente checagem do filesystem montado, que Node.js expõe via `fs.statfs`/chamada equivalente sem dependência nova — viável sem complexidade desproporcional. Pular o item inteiro descartaria um RF explícito do PRD sem tentar primeiro |
| Anti-flood de alerta é por janela de tempo + chave lógica (tipo de alerta + identificador do recurso), configurável em settings | Anti-flood por contagem (ex.: no máximo N alertas/dia sem distinguir tipo) | O RF-13 tem tipos de falha bem distintos (sessão caída, retries esgotados, OAuth, disco, custo) que não devem competir pelo mesmo teto — uma sessão caída não deveria consumir a cota de "alertas do dia" que impediria um alerta de disco cheio de sair. Janela por chave lógica evita esse cross-talk mantendo o princípio simples (settings, não hard-coded) |

(Nenhuma decisão nova de arquitetura de impacto duradouro — o scheduler durável é ADR-004, o padrão de fallback SMTP/log é o mesmo "caminho determinístico sem LLM" do ADR-006 aplicado à infraestrutura, e a estratégia de modelos/preço é ADR-007. Esta feature instancia essas decisões, não abre nenhuma nova.)

## Impacto técnico

- **Banco:** nenhuma tabela nova de domínio esperada além do necessário para dedup/anti-flood de alerta (ex.: registro de "último alerta desta chave, quando") e, se o job de dead man's switch precisar de estado próprio além do que o scheduler já guarda, migração mínima dentro de `infra-ops` ou `core`. Sistema single-user, sem dado de cliente, sem isolamento multi-tenant a testar.
- **API:** `GET /health` muda de resposta (campo/status `degraded` + possível HTTP 503) — é uma mudança de contrato observável por quem consome hoje (watchdog interno, ping do Healthchecks); nenhuma rota nova pública. Superfície pública continua `POST /webhook/evolution` e `GET /health`.
- **Frontend:** nenhum — observabilidade é e-mail + log + `/health`, sem UI.
- **Permissões:** sistema single-user; sem mudança de controle de acesso. `/health` continua sem autenticação (SECURITY.md), pois é consumido por ferramentas externas (Healthchecks.io) e pelo watchdog interno.
- **Áreas sensíveis tocadas (gatilho de `security-auditor` obrigatório):** variáveis de ambiente novas de fato utilizadas pela primeira vez (`SMTP_URL`/`RESEND_API_KEY`/`ALERT_EMAIL`/`HEALTHCHECKS_PING_URL` — já previstas no `.env.example`, mas o transporte real nunca leu/usou credencial de fato até aqui); validar que nenhuma credencial de e-mail entra em log estruturado (mesma regra do `EmailAlerter` atual, que já evita logar e-mail do dono — SECURITY.md §4); validar que o payload de disparo do dead man's switch e do `/health` não vaza informação sensível para uma URL de terceiro (Healthchecks.io recebe só um ping, sem corpo com dado de domínio).

## Testes

| Tipo | O que cobre |
|---|---|
| Unit — `EmailAlerter` real | Envio com sucesso (SMTP mockado / Resend mockado); falha de envio cai em log `error`; dedup/anti-flood não reenvia a mesma chave dentro da janela; janelas diferentes voltam a permitir envio. Nenhuma chamada de rede real nos testes (stub do transporte). |
| Unit — gate do dead man's switch | Só pinga quando DB ok + scheduler com tick recente + sessão conectada; não pinga se qualquer um dos três está fora; usa a mesma função de avaliação do `/health` (teste de não-divergência). |
| Unit — watchdog → alerta | Transição de estado da sessão (conectado → caído, ou pedido de novo QR) dispara `alertRefreshFailure`/alerta equivalente; transições que não mudam o estado de saudável não disparam de novo (mesmo anti-flood). |
| Unit — `/health` degradado | DB inacessível → degraded; scheduler sem tick recente → degraded; sessão desconectada → degraded; todos os três saudáveis → ok; status HTTP corresponde (503 quando degraded). |
| Unit — monitor de custo | Projeção calculada corretamente a partir de tokens gravados (fixture de `messages`); alerta disparado quando projeção > US$25 (settings); alarme disparado quando `cache_read_input_tokens = 0` em N chamadas repetidas ao Sonnet (settings define N); nenhum alarme em uso normal de cache. |
| Unit — alerta de disco | Uso acima do limiar (settings) dispara; abaixo não dispara; falha ao checar disco (best-effort) não derruba o processo, loga e segue. |
| Integração — sessão cai → e-mail | `CONNECTION_UPDATE` simulado para estado caído → e-mail (stub de transporte) recebido com instrução de re-scan, dentro da janela esperada. |
| Integração — retries esgotados → e-mail | Outbox esgota tentativas (mesmo cenário já coberto por FEAT-001/007, agora com transporte real) → e-mail de verdade (stub) recebido, não só log. |
| Integração — cache_read=0 repetido → alarme | Sequência de mensagens ao Sonnet com `cache_read_input_tokens = 0` → alarme disparado; uma única ocorrência isolada não dispara (evita falso positivo de request legítimo sem histórico). |
| Segurança (`security-auditor` obrigatório) | Nenhum secret (SMTP/Resend credential) em log estruturado; env vars novas seguem o padrão de `.env.example`/nunca commitadas; `/health` sem autenticação continua não vazando dado sensível (só estado operacional). |

Nenhum teste desta entrega faz chamada real de e-mail/HTTP externo — todo transporte (SMTP, Resend, Healthchecks.io) é stub/mock.

## Como validar manualmente

1. Configurar `SMTP_URL` (ou `RESEND_API_KEY`) + `ALERT_EMAIL` no `.env` local e forçar um retry esgotado no outbox (ou um refresh OAuth inválido) — e-mail real chega na caixa configurada.
2. Configurar `HEALTHCHECKS_PING_URL` de um check de teste no Healthchecks.io; rodar o Norte por alguns minutos e confirmar os pings no painel; parar o processo inteiro e confirmar que o Healthchecks.io alerta por e-mail após a ausência de ping.
3. Desconectar a sessão do WhatsApp (forçar logout do dispositivo) e confirmar que chega e-mail com instrução de re-scan em até 5 minutos, e que `GET /health` reporta degraded nesse intervalo.
4. Parar o scheduler (ou aguardar sem tick) e chamar `GET /health` — confirma `degraded`/503 mesmo com DB e sessão ok.
5. Forçar `cache_read_input_tokens = 0` em chamadas repetidas ao Sonnet (ex.: variar o system prompt entre requests) e confirmar o alarme por e-mail.
6. Inspecionar o log do monitor de custo (resumo periódico) e conferir que a projeção bate com os tokens gravados em `messages`.

---

## Entrega (preencher no fim, antes do merge)

- **O que foi feito:**
- **PRs:**
- **Migrações:**
- **Pendências/débitos:**
- **Aprendizados:**
