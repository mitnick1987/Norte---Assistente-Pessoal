# Estratégia de Testes — Norte

**Versão:** 1.0 · **Data:** 2026-08-25 · Referências: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md)

Pirâmide: **base larga de unitários no domínio puro, integração nos fluxos do PRD §6, poucos E2E de cenário de conversa**. Nenhum PR mergeia com suite vermelha.

Ferramentas: **Vitest** (unit e integração) · **`fastify.inject()`** para integração webhook → resposta, contra **SQLite em memória ou arquivo temporário** (nunca mock do banco) · suíte de **cenários E2E de conversa** que simula webhooks da Evolution e verifica as mensagens enfileiradas no **outbox** (sem WhatsApp real no CI) · **ESLint** com `eslint-plugin-boundaries` para as fronteiras de módulo do [ARCHITECTURE.md §2](ARCHITECTURE.md) (violação de fronteira falha o CI) · **`tsc --noEmit`** para typecheck · **gitleaks** para secret scanning · **`npm audit` + Dependabot** para dependências.

---

## 1. Unitários

Alvo: lógica pura do domínio (`src/core/*/domain`, `src/modules/*/domain` — ver [ARCHITECTURE.md §4](ARCHITECTURE.md)). Rápidos (< 30 s a suite), sem rede/banco/relógio real.

- Todo módulo de domínio crítico tem **gate de cobertura no CI**.
- Código que valida/interpreta entrada externa (payload do webhook, output estruturado do Haiku): **100% dos caminhos de erro** cobertos.
- **Golden tests:** casos reais de formulação de briefing/revisão/cobrança aprovados pelo dono viram fixtures; regressão neles bloqueia merge — nunca se ajusta o esperado para o teste passar sem aprovação explícita do dono.
- Contratos de entrada/saída: round-trip serialize/parse dos schemas zod das tools strict (RF-01, RF-12) e do payload do webhook.
- Corretude temporal: todo cálculo de data/recorrência é testado com fuso `America/Sao_Paulo` explícito, cruzando meia-noite e virada de mês (RNF "Corretude temporal").

| Área | Casos obrigatórios | Cobertura (gate) |
|---|---|---|
| `core/scheduler` (domínio) | próxima ocorrência de recorrência TZ-aware; elegibilidade de catch-up no boot (job vencido durante o restart); job já disparado não dispara de novo | ≥ 90% |
| `core/outbox` | confirmação só pós-2xx; retry exponencial (contagem e backoff); teto diário de proativas respeitado; alerta disparado ao esgotar retries | ≥ 90% |
| `modules/chains` (domínio) | expansão de compromisso em véspera/manhã/preparo descontando deslocamento; expansão de pagamento em cadeia de vencimento; evento sem hora não gera cadeia inválida | ≥ 90% |
| `modules/nudges` (domínio) | elegibilidade de cobrança (vencido, teto diário, supressor do modo retorno); proposta de reagendamento a partir de `patterns`; nunca cobra o mesmo item duas vezes no mesmo dia | ≥ 90% |
| `modules/next-action` (domínio) | seleção da UMA próxima ação por prazo/prioridade/hora do dia; empate resolvido deterministicamente | ≥ 70% |
| `modules/rituals` (domínio) | montagem dos dados de briefing/revisão (3 prioridades, micropasso); template de fallback determinístico sem LLM | ≥ 70% |
| `modules/hygiene` (domínio) | 3+ adiamentos ou 21+ dias parada gera proposta; `adiamentos_count` nunca sai da camada de domínio para a mensagem ao usuário | ≥ 70% |
| `modules/return-mode` (domínio) | limiar de 48h de silêncio; supressão de cobranças acumuladas; resumo de reentrada não exige decisão | ≥ 70% |
| Restante (`core/kernel`, `core/bus`, `core/db`, demais módulos) | caminho feliz + erros previsíveis | ≥ 70% |

## 2. Integração

Sobem contra **SQLite real** (arquivo temporário por suite, migrações aplicadas do zero a cada run — valida as migrações dos módulos no CI) e o Fastify real via `fastify.inject()`. Nenhuma dependência mockada no que é testado como integração.

- `POST /webhook/evolution` testado ponta a ponta: payload → validação zod → dedup → gravação no task-store → efeito no bus → item no outbox. Ver fluxos do [PRD §6](PRD.md).
- `GET /health` reporta corretamente estado degradado (sessão caída, scheduler parado, última entrega falha).
- **Servidor não confia no cliente:** nenhum dado enviado no payload do webhook é tratado como fato sem revalidação (ex.: `adiamentos_count`, `status`, datas calculadas nunca vêm prontos de fora — sempre recomputados no backend a partir do task-store).
- **Idempotência:** reentrega do mesmo `wa_message_id` (webhook duplicado da Evolution, ver ADR-004) não duplica item, reminder nem mensagem de saída.
- Scheduler (`core/scheduler`) contra o banco real: job vencido é pego no poll de 30s; catch-up no boot processa jobs vencidos durante o downtime; recorrência gera a próxima ocorrência no disparo, não antes.
- Outbox contra Evolution simulada (`nock`/stub HTTP, nunca a Evolution real): 2xx marca `delivered_at`; falha aciona retry exponencial; retries esgotados geram alerta (verificado por assertion no client de e-mail, também stubado).

Rotas e jobs com teste de integração obrigatório:

| Rota/Job | Cenário mínimo |
|---|---|
| `POST /webhook/evolution` (texto) | captura → confirmação em outbox em 1 linha, sem pergunta de estrutura (RF-01) |
| `POST /webhook/evolution` (áudio) | busca mídia via `getBase64FromMediaMessage`, nunca o base64 do payload (RF-02) |
| `POST /webhook/evolution` (comando "feito"/"1"/"2"/"3") | resolvido pelo executor determinístico, sem chamar o Sonnet (RF-07) |
| job `reminder` | template sem LLM, dispara só após `fire_at`, confirma pós-2xx (RF-03) |
| job `briefing` | dados coletados por código; falha do Claude cai no template de fallback com os mesmos dados (RF-05) |
| job `revisao` | no máximo 3 mensagens, todas respondíveis por número; fallback template (RF-06) |
| job `cobranca` | menu 1/2/3; nunca excede o teto diário de settings (RF-08) |
| catch-up no boot | processo reiniciado com jobs vencidos na tabela `jobs` dispara todos ao subir (RF-03, ADR-004) |

## 3. Suite de segurança/isolamento — obrigatória

Bloqueia merge. Norte é **single-user**: não há RLS multi-tenant nem matriz de papéis (ver [ARCHITECTURE.md §3.1](ARCHITECTURE.md) e [SECURITY.md](SECURITY.md)). O isolamento relevante aqui é de **borda** — só o dono, autenticado pela instância Evolution correta, produz efeito no sistema — e de **integridade do caminho crítico** — nenhuma entrada externa derruba ou falsifica o motor de lembretes. Cada cenário roda contra o Fastify real e o SQLite real (`fastify.inject()`), nunca mockando a validação.

| # | Cenário | Esperado |
|---|---|---|
| S1 | Webhook sem o segredo de autenticação (`AUTHENTICATION_API_KEY`) configurado na Evolution | rejeitado antes de qualquer processamento (401/403) |
| S2 | Webhook de instância Evolution diferente da configurada | ignorado e logado, nenhum efeito no task-store |
| S3 | Comando que tentaria ultrapassar o teto diário de mensagens proativas (settings) enviado repetidamente | outbox recusa o excedente no backend, não só por ausência de gatilho |
| S4 | Tool call do modelo fora do schema strict (`additionalProperties: false`) ou violando estado válido do task-store | rejeitada pela validação zod no backend, nunca gravada |
| S5 | Tentativa de `DELETE` físico em qualquer entidade via caminho que não seja o de domínio (SQL direto fora de `modules/tasks`) | inexistente no código — teste de fronteira de módulo (`eslint-plugin-boundaries`) mais teste de que toda remoção via serviço vira `status = dropped/archived` |
| S6 | Requisição ao `/webhook/evolution` sem os campos mínimos do contrato (payload vazio, tipo inesperado) | 0 efeito no task-store, resposta de erro controlada, processo não cai (fail-closed) |
| S7 | Webhook com JID diferente do número do dono | ignorado e logado (`warn`), nenhum item criado, nenhuma resposta enviada — controle de acesso principal do produto single-user |
| S8 | Reentrega do mesmo `wa_message_id` (webhook duplicado da Evolution) | dedup: nenhum item, reminder ou mensagem de saída duplicados |
| S9 | Logger recebe payload contendo token/segredo (`AUTHENTICATION_API_KEY`, `refresh_token`, chave da API Claude) | campo redigido/omitido na saída do log — asserção direta sobre o output do logger, nunca aparece em texto plano |
| S10 | Payload de webhook malformado (JSON inválido, campos com tipo errado, estrutura inesperada da Evolution) | rejeitado pela validação zod com erro controlado; processo **não** derruba (sem exceção não tratada, sem crash do Fastify) |

## 4. E2E (cenários de conversa)

Sem UI própria (interface é 100% WhatsApp — ver [PRD §2](PRD.md)): o "E2E" do Norte é uma suíte de **cenários que simulam sequências de webhooks da Evolution** e verificam as mensagens resultantes no **outbox**, sem tocar a rede real do WhatsApp. Cada cenário sobe o Fastify + SQLite reais e roda o scheduler em modo acelerado (tempo controlado, nunca `Date.now()` real).

Fluxos cobertos (um por fluxo principal do [PRD §6](PRD.md)):

1. **Captura por áudio → confirmação** — webhook de áudio simulado → STT stubado → N itens no task-store → 1 mensagem de confirmação no outbox, sem nenhuma pergunta de estrutura.
2. **Briefing matinal, caminho feliz** — job de briefing dispara no horário configurado → mensagem no outbox com agenda + até 3 prioridades + micropasso.
3. **Briefing matinal, fallback** — API do Claude indisponível (stub retorna erro) → mensagem de template determinístico ainda assim sai no outbox, com os mesmos dados.
4. **Compromisso → cadeia de lembretes → disparo** — criação de evento com hora → reminders gerados na tabela `jobs` → avanço de tempo simulado até `fire_at` → mensagens de véspera/manhã/preparo aparecem no outbox na ordem certa.
5. **Fechamento de loop** — item com prazo vencido → cobrança no outbox com menu 1/2/3 → resposta simulada "2" → nova mensagem propõe horário concreto (não pergunta "para quando?") → status atualizado.
6. **Modo retorno sem culpa** — 48h de silêncio simulado com cobranças pendentes → mensagem do usuário reaparece → exatamente 1 mensagem de resumo de reentrada no outbox, sem cobranças acumuladas despejadas.
7. **Restart com jobs vencidos (catch-up)** — jobs com `next_run_at` no passado persistidos → processo reinicia → todos disparam no boot, nenhum perdido.
8. **Falha de entrega esgota retries** — Evolution simulada sempre retorna erro → outbox esgota o retry exponencial → alerta por e-mail (stub) é chamado — nenhuma falha silenciosa.

Regras adicionais:

- Limites de negócio (teto diário de proativas, teto de cobranças/dia) testados sempre no backend — não há "UI" separada para testar dos dois lados.
- Cenário que gera efeito persistente (item, reminder, mensagem) verifica o estado final no SQLite, não só a resposta HTTP do `fastify.inject()`.

### 4.1 Suite de TOM — obrigatória, regressão no CI (RF-14)

Requisito de produto, não estético: uma mensagem que soe crítica é bug. Exemplos adversariais cobrindo os templates e os prompts que geram cobrança/briefing/revisão/higiene:

- Cobrança nunca cita histórico de falhas ou contagem de adiamentos — string `adiamentos_count` (ou sua paráfrase) nunca aparece em nenhuma mensagem enviada ao usuário, em nenhum cenário.
- Nenhuma mensagem usa tom de crítica/fiscal ("você não fez de novo", "3ª vez que você adia") — lista de padrões proibidos testada contra toda mensagem gerada por template e contra amostras de saída do Sonnet nos golden tests.
- Toda cobrança oferece a opção "dropar" no menu.
- Modo retorno nunca despeja cobranças acumuladas: cenário de 48h+ de silêncio com múltiplos itens vencidos gera **no máximo** a mensagem de resumo de reentrada — teste falha se mais de 1 mensagem proativa sair na primeira interação pós-retorno.
- Retrospectiva mensal (RF-27, M3) nunca inclui taxa de conclusão, comparação com meses anteriores em tom de cobrança ou métricas de falha.

### 4.2 Suite de FALHA INJETADA — obrigatória, regressão de confiabilidade (RNF)

Cada cenário injeta a falha e verifica que o caminho crítico do PRD segue entregando:

- **API do Claude indisponível** (timeout/erro simulado): briefing e revisão noturna saem por template de fallback determinístico, com os mesmos dados que sairiam pelo Sonnet — nunca silêncio.
- **Restart do processo com jobs vencidos:** catch-up no boot dispara todos os jobs com `next_run_at` no passado, sem duplicar os que já tinham `delivered_at`.
- **Envio sem 2xx da Evolution:** retry exponencial segue o backoff esperado; ao esgotar as tentativas, alerta por e-mail é disparado e o job é marcado `failed` (nunca fica preso em silêncio).
- **Agendamento cruzando meia-noite e virada de mês em `America/Sao_Paulo`:** cadeia de lembretes e recorrência calculam a próxima ocorrência corretamente nas fronteiras de dia/mês/horário de verão inexistente no Brasil (não há mais DST desde 2019, mas o teste fixa o fuso explicitamente para não depender do TZ do runner do CI).

## 5. Não-funcionais

- **Carga:** não se aplica — Norte é single-user (RF não-objetivo explícito, [PRD §1](PRD.md)), sem endpoints públicos além do webhook de uma única instância Evolution autenticada. Não há meta de VUs/RPS; a única meta relevante de desempenho é latência percebida (ver tabela abaixo), verificada em teste de integração, não em teste de carga.
- **Latência percebida (RNF do PRD):** confirmação de captura ≤ 15s do recebimento do webhook (integração); comandos simples resolvidos pelo executor determinístico ≤ 5s, sem acionar o Sonnet (integração, com assertion de que o client do Sonnet não foi chamado).
- **Acessibilidade:** não se aplica — não há UI própria (interface 100% conversacional, [ARCHITECTURE.md §1](ARCHITECTURE.md)); UI futura do ADR-012 herdaria o gate de acessibilidade do design system do MedClinic quando existir.
- **Visual:** não se aplica — sem tela própria.
- **Corretude temporal:** ver suite de FALHA INJETADA (§4.2) — cobre meia-noite, virada de mês e fuso `America/Sao_Paulo` explícito em todo cálculo de recorrência.

## 6. CI/CD — gates

Dois jobs de CI, nomes exatos usados na proteção de branch:

```
PR → "Lint, typecheck, testes e build"
       lint (eslint + eslint-plugin-boundaries) + tsc --noEmit
       → unit (gates de cobertura por módulo, §1)
       → integração (webhook→resposta, scheduler, outbox — SQLite real)
       → build

   → "Gates de segurança"
       gitleaks (secret scanning) + npm audit
       → suite de segurança/isolamento S1..S10 (§3)
       → suite de TOM (§4.1)
       → suite de FALHA INJETADA (§4.2)

merge (main) → nenhum passo adicional de deploy automático
tag SemVer  → build de imagem Docker → docker compose pull/up no VPS (ver ARCHITECTURE.md §1, infra/docker-compose.yml)
```

Ambos os jobs — "Lint, typecheck, testes e build" e "Gates de segurança" — são obrigatórios na proteção da branch `main`; nenhum PR mergeia com qualquer um deles vermelho ou pulado.

**Checklist de release** (antes de mover a tag em produção):

- Suites acima verdes na tag.
- **Restauração do backup Litestream testada** (restore do snapshot do Backblaze B2 para uma instância limpa, verificando integridade do SQLite) — gate manual, obrigatório a cada milestone (M1/M2/M3), não em todo release menor.
- Métricas de saúde operacional do [PRD §7](PRD.md) (downtime detectável em ≤ 5 min, sessão WhatsApp recuperável em ≤ 12h) revisadas manualmente após deploy.

Flakiness: cenário de E2E/conversa que falhar 2× sem mudança relacionada entra em quarentena com issue aberta — não se apaga teste vermelho; ou o código está errado, ou o teste está errado, e a diferença precisa ser resolvida antes do próximo merge que toque a área.
