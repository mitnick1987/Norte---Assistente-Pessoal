# PRD — Norte (assistente pessoal para TDAH via WhatsApp)

**Versão:** 0.1 · **Data:** 2026-08-25 · **Status:** rascunho para revisão

Este documento é a fonte única do "o quê" e do "por quê". O "como" fica em [ARCHITECTURE.md](ARCHITECTURE.md). Nome do produto em aberto — "Norte" é o provisório; alternativas consideradas: Prumo, Tino, Rumo, Farol.

---

## 1. Visão Geral

O Norte é um assistente pessoal single-user que mora no WhatsApp do usuário e funciona como memória de trabalho externa e "córtex pré-frontal de aluguel" para um cérebro com TDAH: captura qualquer coisa (texto solto, áudio, foto, encaminhamento) sem fazer nenhuma pergunta, estrutura sozinho, e devolve no momento certo — briefing matinal com no máximo 3 prioridades, lembretes em cadeia contra a cegueira temporal, cobrança neutra que verifica se a coisa foi feita, e revisão noturna curta. Diferente de todo app de produtividade, ele não espera ser aberto: puxa a conversa por iniciativa própria, em PT-BR, com tom de colega adulto e zero culpa.

Duas teses inegociáveis orientam todo o design:

1. **Adesão de longo prazo** — a métrica de sucesso não é engajamento diário, é ainda estar em uso daqui a 6 meses. Por isso modo retorno sem culpa, higiene automática da lista e tom RSD-safe são MVP, não melhorias.
2. **Confiabilidade dos lembretes** — o lembrete que não chega destrói a confiança de uma vez. Por isso o caminho crítico é 100% determinístico (jobs em SQLite, templates sem LLM, entrega confirmada, catch-up no boot), os rituais têm fallback em template se a API do Claude cair, e nenhuma falha é silenciosa (watchdog + dead man's switch externo). O LLM interpreta, conversa, prioriza e formula planos — mas nunca é o registro nem ponto único de falha do valor diário.

### Problema

- Apps de produtividade exigem exatamente as funções executivas que o TDAH prejudica (lembrar de abrir o app, categorizar, revisar) — o usuário já abandonou vários no ciclo "usa uma semana → falha um dia → culpa → abandona".
- Pensamentos e compromissos evaporam da memória de trabalho em segundos se a captura exigir qualquer estrutura (projeto? prazo? tag?) — cada micro-decisão na captura mata o hábito.
- Cegueira temporal: alarme único no horário do evento chega tarde demais; falta a noção de "quanto falta" e do tempo de preparação/deslocamento.
- Paralisia por sobrecarga: ver o backlog inteiro trava em vez de ativar; a pergunta real é sempre "qual a próxima coisa?".
- Travamento na iniciação: adultos com TDAH executam bem planos prontos, mas travam em formular o plano (quebrar a tarefa, definir o primeiro passo).
- Ferramentas espalhadas (agenda num app, tarefas noutro, ideias no bloco de notas, trabalho no Jira) — nada centraliza, e o que não está no lugar que ele olha não existe.
- Cobrança com tom de crítica dispara RSD (disforia sensível à rejeição): vergonha, evitação do próprio sistema e abandono definitivo.
- Sumiços de 2–3 dias são inevitáveis; sistemas que acumulam cobranças e exigem "colocar em dia" transformam o retorno no ponto de abandono.

### Solução

- **Captura com atrito zero no WhatsApp:** texto solto, áudio (transcrito) e foto viram itens classificados automaticamente, confirmados em 1 linha, sem nenhuma pergunta de estrutura — proibição codificada no system prompt e na triagem.
- **Proatividade determinística e confiável:** briefing matinal (agenda + máx. 3 prioridades + primeiro micropasso), lembretes em cadeia (véspera → manhã → "hora de sair" com deslocamento, formulados como tempo restante) e revisão noturna — tudo iniciado pelo assistente, com fallback em template se o LLM cair.
- **Fechamento de loop, a maior lacuna do mercado:** o assistente não só lembra, verifica — cobrança neutra com menu numerado (1 feito / 2 reagendar / 3 dropar), reagendamento inteligente pelo horário em que o usuário historicamente responde, teto diário anti-spam.
- **Destravamento terceirizado:** quando detecta tarefa parada ou 3+ adiamentos, o assistente formula o plano — micropassos quase ridículos, "só 5 minutos", if-then contextualizado ("agora é uma boa hora: faltam 15 min até a reunião") e sessões de foco com check-in.
- **Sistema que perdoa:** modo retorno sem culpa (sumiço → reabsorção silenciosa + um resumo compacto pronto), higiene automática da lista, deleção sempre lógica e reversível, zero streaks, zero contadores de falha, recompensa imediata e adulta a cada conclusão.
- **Um único cérebro:** Google Calendar no MVP (briefing e cadeias com a agenda real), Gmail dosado no briefing em M2, ferramenta de trabalho em M3 — tudo convergindo para o mesmo funil capturar→lembrar→cobrar→priorizar num só chat.

### Não-objetivos da v1

- Multi-usuário / SaaS / onboarding de terceiros — é um sistema pessoal de um usuário só; nenhuma decisão de arquitetura paga o custo de escalar.
- App próprio (mobile ou web), dashboard ou qualquer UI fora do chat — a interface é 100% conversa no WhatsApp (e-mail apenas para alertas de infraestrutura).
- WhatsApp Cloud API oficial (templates, janela de 24h, custo por conversa) — a v1 aposta na Evolution API não-oficial com mitigações; migração fica como plano B documentado.
- Ações autônomas no mundo externo: enviar e-mails, fazer ligações, comprar, responder terceiros — nem com confirmação na v1; o assistente age só sobre os dados do próprio usuário.
- Gamificação: streaks, badges, pontos, níveis, contadores de falha — explicitamente proibidos, não adiados.
- Botões e listas interativas do WhatsApp (e sendPoll) — instáveis no Baileys; a UX é menu de texto numerado por decisão de design, não por limitação temporária.
- Substituir tratamento (medicação/terapia) ou usar linguagem clínica — é ferramenta de suporte de função executiva, complementar (alerta explícito da CHADD).
- RAG, vector DB, filas, microserviços, Kubernetes — a memória é markdown consolidado + SQLite; a arquitetura é um monolito mantível por uma pessoa daqui a 2 anos.
- Retrospectiva semanal com Opus — existe apenas a retrospectiva mensal descritiva, redigida pelo Sonnet.

---

## 2. Decisões de Produto

| Aspecto | Decisão v1 |
|---|---|
| Modo de operação | Sistema pessoal single-user, rodando 24/7 em VPS próprio; sem contas, sem onboarding de terceiros |
| Canal | WhatsApp via Evolution API (pinada na última estável, 2.3.7), em **número secundário dedicado** — nunca o número principal do usuário |
| Interface | 100% conversa; menus de texto numerado (1/2/3); botões/listas/enquetes do WhatsApp banidos do design |
| Fonte da verdade | Task-store determinístico em SQLite; o LLM interpreta e conversa, mas **nunca é o registro** (anti-alucinação de compromissos) |
| Confiabilidade | Caminho crítico de lembretes 100% sem LLM (templates + jobs duráveis); briefing/revisão com fallback em template; nenhuma falha silenciosa |
| Tom | RSD-safe hard-coded: colega adulto, neutro, zero culpa; proibido citar histórico de falhas; suite de regressão de tom no CI |
| Proatividade | Sempre iniciada pelo assistente; teto de ~6 mensagens proativas/dia e 10–15 lembretes ativos (parâmetros em settings) |
| Modelos de IA | Haiku 4.5 (triagem/extração/consolidação) + Sonnet 5 (conversa/priorização) com prompt caching; sem Opus |
| Dados | 100% no VPS próprio + backup contínuo cifrado; deleção sempre lógica; nada de analytics de terceiros |
| Posicionamento | Ferramenta de suporte de função executiva, complementar a tratamento; sem linguagem clínica |

---

## 3. Personas

| Persona | Descrição | Necessidade principal |
|---|---|---|
| Dono (usuário único) | Adulto brasileiro com TDAH; trabalho + vida pessoal espalhados em várias ferramentas; já abandonou vários apps de produtividade | Não esquecer, capturar sem atrito, receber prioridades prontas e ser cobrado sem culpa — sem depender da própria disciplina |

---

## 4. Requisitos Funcionais

### RF-01 — Captura de texto com atrito zero (M1)

- Qualquer mensagem de texto (inclusive encaminhada) vira item classificado pelo Haiku em tarefa | ideia | compromisso | lembrete | nota, com data/hora extraídas quando houver.
- Confirmação em 1 linha ("Anotei: ...") em até 15s do recebimento.
- É proibido (verificável por teste de prompt) perguntar projeto, prazo, categoria ou tag no momento da captura; classificação ambígua cai na inbox e é resolvida no briefing seguinte.

### RF-02 — Áudio como entrada de primeira classe (M1)

- Áudio do WhatsApp é buscado via `getBase64FromMediaMessage` (nunca o base64 do webhook), transcrito via Groq whisper-large-v3-turbo com fallback OpenAI Whisper atrás de interface de STT isolada.
- Um áudio com N assuntos gera N itens, todos confirmados numa única resposta curta.
- Falha total de STT gera resposta pedindo o conteúdo por texto — nunca silêncio.

### RF-03 — Motor de lembretes durável, caminho crítico sem LLM (M1)

- Todo comportamento proativo é uma linha na tabela `jobs` do SQLite (`next_run_at` em America/Sao_Paulo); restart/deploy não perde nenhum job — catch-up de vencidos no boot é testado.
- Lembrete só é marcado entregue após resposta 2xx da Evolution API; retry exponencial; esgotar retries dispara alerta por e-mail.
- Lembretes pontuais saem por template determinístico, sem chamada de LLM no caminho crítico.
- Recorrência gera a próxima ocorrência no momento do disparo.

### RF-04 — Lembretes em cadeia contra cegueira temporal (M1)

- Compromisso com hora gera automaticamente (código puro, nunca LLM): véspera à noite, manhã do dia e "hora de se preparar/sair" descontando deslocamento.
- Alertas de saída formulados como tempo restante ("faltam 40 min"), nunca só horário absoluto.
- Antecedências configuráveis em settings, com defaults sensatos.

### RF-05 — Briefing matinal "3 + agenda" com fallback (M1)

- Job diário em horário fixo configurável (padrão 7h40): agenda do dia (Google Calendar) + no máximo 3 prioridades + primeiro micropasso da prioridade 1 + pergunta acionável ("qual você encara primeiro?").
- Nunca exibe o backlog completo; redigido pelo Sonnet com formulação variada dia a dia.
- Se a API do Claude falhar, um template determinístico com os mesmos dados é enviado — o briefing nunca deixa de chegar (verificável por teste de falha injetada).

### RF-06 — Revisão noturna de 2 minutos com fallback (M1)

- Job às 21h30 (configurável), sempre iniciado pelo assistente: o que fechou (reconhecimento), o que rola para amanhã (reagendado automaticamente, sem culpa), no máximo UMA decisão pedida.
- Máximo de 3 mensagens, todas respondíveis com números.
- Fallback em template determinístico se o LLM falhar.

### RF-07 — Executor determinístico de comandos simples (M1)

- "feito", "adia pra sexta", "dropa" e respostas numéricas de menu são resolvidos por código + Haiku, sem acionar o Sonnet.
- Resposta em até 5s; conclusão recebe reconhecimento imediato em 1 linha, adulto, com formulação variada.
- Cobertura ≥ 40% dos turnos diários sem Sonnet (verificável no log de custo).

### RF-08 — Fechamento de loop: cobrar e verificar (M1)

- Tarefa com prazo vencido ou prioridade do dia não confirmada gera UMA cobrança neutra com menu: "1 feito / 2 reagendar / 3 dropar".
- Teto de cobranças por dia (settings); jamais menciona contagem de adiamentos ou histórico de falhas (teste de regressão de tom).
- Resposta "2 reagendar" propõe horário concreto baseado nos padrões do usuário quando existirem (ex.: sábado de manhã), em vez de perguntar "para quando?".

### RF-09 — Comando "qual a próxima?" (M1)

- Qualquer formulação da pergunta retorna UMA única próxima ação concreta, escolhida por prazo, prioridade e hora do dia.
- Lista completa só é exibida mediante pedido explícito ("me mostra tudo").

### RF-10 — Modo retorno sem culpa (M1)

- 48h+ de silêncio do usuário: cobranças acumuladas são suprimidas e a proatividade é reduzida ao essencial (só compromissos com hora).
- Na primeira mensagem do usuário (ou no briefing seguinte), envia UM resumo compacto de reentrada, pronto, sem pedir nenhuma decisão no momento da volta.
- Proibido despejar cobranças acumuladas ou pedir "colocar em dia" (teste de cenário).

### RF-11 — Higiene automática da lista (M1)

- Tarefa com 3+ adiamentos ou 21+ dias parada gera proposta na revisão noturna: arquivar / dropar / adiar para o mês que vem — tratada como manutenção de rotina, nunca como fracasso.
- Deleção sempre lógica (status dropped/archived), nunca física — dropar é reversível.
- `adiamentos_count` nunca é exibido ao usuário.

### RF-12 — Google Calendar em linguagem natural (M1)

- Agenda do dia lida do Calendar alimenta briefing e gera cadeias de lembrete; "marca dentista quinta 16h" cria o evento via tool `create_event` (strict).
- OAuth de app External publicado "In Production" (refresh token não expira em 7 dias), escopo mínimo `calendar.events`.
- Falha de refresh do token dispara alerta por e-mail (nunca quebra em silêncio).

### RF-13 — Watchdog, dead man's switch e alertas (M1)

- `CONNECTION_UPDATE` monitorado; sessão caída ou pedido de novo QR dispara e-mail com instrução de re-scan em até 5 min.
- Dead man's switch externo (Healthchecks.io, grátis): o brain pinga a cada 5 min; ausência de ping alerta por e-mail mesmo com o VPS inteiro fora.
- Nenhuma falha de entrega é silenciosa: lembrete que esgotou retries, refresh OAuth falho e disco cheio alertam por e-mail.

### RF-14 — Tom RSD-safe e recompensa imediata (M1, transversal)

- Regras hard-coded no system prompt: proibido citar histórico de falhas ("3ª vez que você adia"), tom de fiscal e tom de animador de torcida; toda cobrança oferece "dropar".
- Suite de testes de regressão de tom com exemplos adversariais roda no CI; mensagem que soe crítica é bug.
- Toda conclusão recebe reconhecimento NA HORA, em 1 linha; zero streaks, badges ou contadores de falha em todo o produto.

### RF-15 — Monitor de custo de API (M1)

- `tokens_in` / `tokens_out` / `cache_read` registrados por chamada na tabela `messages`.
- Alerta por e-mail quando a projeção mensal passar de US$25.
- Alarme quando `cache_read_input_tokens` = 0 em requests repetidos (regressão silenciosa de 5–10x no custo).

### RF-16 — Foto e print viram compromisso (M2)

- Print de convite, cartaz ou conversa passa pelo Claude vision: extrai evento/tarefa/data/local e propõe criação com confirmação de 1 toque ("ok").
- Mensagem encaminhada com data/hora detectada vira evento/tarefa sugerida automaticamente.
- Mesmo funil e mesma confirmação de 1 linha da captura de texto.

### RF-17 — Quebra em micropassos e "só 5 minutos" (M2)

- Tarefa grande parada, 3+ adiamentos ou pedido explícito ("não consigo começar") dispara o Sonnet formulando micropassos quase ridículos e propondo SÓ o primeiro, ou a versão "só 5 minutos".
- O briefing já inclui o primeiro micropasso da prioridade 1 desde o M1; aqui a quebra vira reativa e sob demanda.

### RF-18 — Intenções de implementação (if-then) contextualizadas (M2)

- Intenção vaga ("preciso ligar pro banco") vira gatilho concreto negociado em uma pergunta ("depois do almoço, 13h30 — topa?").
- O disparo é situado no tempo real do dia: "agora é uma boa hora: faltam 15 min até você precisar sair para a reunião".

### RF-19 — Memória de longo prazo consolidada (M2)

- Job noturno via Batch API (50% off, Haiku) destila a conversa em fatos duráveis (pessoas, projetos, rotinas, preferências) com campo `confidence`, injetados como bloco markdown no system prompt cacheado.
- O system prompt permanece byte-estável durante o dia (data sempre na última mensagem do usuário); atualização de facts só na consolidação noturna.
- Correção por conversa em 1 mensagem ("isso era ideia, não tarefa") atualiza o item e vira fact.

### RF-20 — Sessões de foco: body doubling por mensagem (M2)

- "foco 25" ou aceite de proposta inicia timebox: "Começa agora. Volto às 14h25."
- Check-in de fim registrado como job durável, com reconhecimento imediato do que saiu.
- Propostas surgem quando há prioridade do dia parada no meio do dia.

### RF-21 — Planejamento por energia (M2)

- Sinal de estado ("tô morto", "sem foco") ou pergunta ocasional de bateria leva a sugestão de tarefa compatível com a energia atual, não a "mais importante".
- Itens ganham `energia_necessaria` (leve|média|pesada) preenchida na classificação, nunca perguntada ao usuário.

### RF-22 — Gmail no briefing, leitura dosada (M2)

- Escopo `gmail.readonly`; triagem pelo Haiku seleciona no máximo 2 e-mails que exigem ação para o briefing, como sugestão de tarefa ("viro tarefa? 1 sim / 2 ignora").
- Nunca notificação de e-mail em tempo real.

### RF-23 — Planejamento por capacidade real (M2)

- Cada tarefa ganha duração estimada (sugerida pelo modelo, ajustável por conversa).
- O briefing cruza a soma das prioridades com as horas realmente LIVRES do Calendar e avisa superlotação antes do dia começar ("suas 3 somam 6h, você tem 3h livres — corta uma?").

### RF-24 — Proatividade adaptativa (M3)

- Tabela `patterns` acumula horários de resposta, ignorados e pedidos de silêncio; briefing desliza para o horário real de despertar e cobranças migram para janelas de resposta.
- Queda na taxa de resposta às proativas reduz volume automaticamente; teto diário permanece como limite duro em settings.

### RF-25 — Boletos e pagamentos por foto (M3)

- Foto de boleto/conta extrai valor e vencimento e cria cadeia específica (3 dias antes, véspera, dia) com verificação de conclusão ("pagou? 1 sim / 2 amanhã").
- Categoria própria "pagamento" no modelo de dados.

### RF-26 — Integração com ferramenta de trabalho (M3)

- Conector plugável (Jira/Trello/Linear) alimenta o mesmo funil: cards atribuídos com prazo aparecem como candidatos a prioridade no briefing (leitura primeiro).
- Evolução na própria fase: concluir no chat sincroniza a conclusão na ferramenta (escrita mínima, apenas status).

### RF-27 — Retrospectiva mensal sem julgamento (M3)

- Uma mensagem por mês, descritiva: o que andou, padrões observados, UMA sugestão de ajuste no sistema.
- Proibido: taxa de conclusão, comparação com meses anteriores em tom de cobrança, métricas de falha.

### RF-28 — Canal de contingência Telegram (M3)

- Adapter de canal alternativo dormente: banimento do número ou quebra prolongada da Evolution → migração para bot Telegram com todos os dados intactos.
- Teste trimestral de ativação registrado como job recorrente.

### RF-29 — Checklist de preparação no alerta de saída (M3)

- Eventos podem ter checklist curto (`prep_itens`): o alerta "hora de sair" inclui "Pegou o carregador?" — memória de trabalho externa também para objetos.
- Itens do checklist sugeridos pelo modelo na criação do evento, confirmados em 1 toque.

---

## 5. Requisitos Não-Funcionais

| Categoria | Requisito |
|---|---|
| Confiabilidade | Taxa de entrega de lembretes ≥ 99,5%; nenhum job perdido em restart (catch-up no boot testado); entrega confirmada só pós-2xx com retry exponencial; briefing e revisão nunca deixam de chegar (fallback template). |
| Observabilidade | Nenhuma falha silenciosa: watchdog de `CONNECTION_UPDATE`, dead man's switch externo (Healthchecks.io), alertas por e-mail (canal fora do WhatsApp) para sessão caída, retries esgotados, OAuth quebrado e disco cheio. |
| Custo | Custo total ≤ US$32/mês com alerta em US$25; prompt caching byte-estável é requisito (não otimização): system prompt congelado, data na última mensagem, alarme se `cache_read_input_tokens` = 0. |
| Latência percebida | Confirmação de captura ≤ 15s; comandos simples ≤ 5s (executor determinístico, sem Sonnet); mensagens proativas com delay aleatório 10–45s + sendPresence "composing" (anti-banimento). |
| Segurança | Porta da Evolution nunca exposta (Caddy + TLS + `AUTHENTICATION_API_KEY` forte); secrets só em `.env` fora do git; refresh token do Google cifrado em repouso; escopos OAuth mínimos; validação de entrada em 100% das rotas/webhooks. |
| Privacidade | Dados 100% no VPS próprio + backup cifrado no B2; nada de analytics de terceiros; a fonte da verdade nunca vive no WhatsApp (banimento = trocar chip, zero perda de dados). |
| Manutenibilidade | Mantível por uma pessoa daqui a 2 anos: monolito Node/TS, uma persistência (SQLite), dependências mínimas e pinadas, sem filas/microserviços/k8s; loop de tool use manual da Messages API. |
| Corretude temporal | America/Sao_Paulo explícito em todo armazenamento e cálculo de recorrência; testes de agendamento cruzando meia-noite e virada de mês. |
| Tom (testável) | Tom RSD-safe com suite de regressão adversarial no CI; zero mecânica punitiva em qualquer mensagem; teto de ~6 proativas/dia e 10–15 lembretes ativos como parâmetros em settings. |
| Resiliência de fornecedores | Adapter isola a Evolution (troca por WAHA/Baileys/Telegram em dias); interface de STT isolada (Groq → OpenAI Whisper); degradação graciosa se a API do Claude cair (só a conversa livre degrada, o caminho crítico segue). |
| Anti-banimento | Número secundário dedicado e aquecido (nunca o principal), < 50 msgs/dia no início, delays aleatórios, conteúdo variado, sem links em massa; backup contínuo garante recuperação em minutos. |

---

## 6. Fluxos Principais

1. **Captura por áudio:** webhook `MESSAGES_UPSERT` → adapter busca mídia via `getBase64FromMediaMessage` → STT (Groq, fallback OpenAI) → Haiku extrai N ações com output estruturado → tools strict gravam no task-store (SQLite) → confirmação em 1 linha, sem nenhuma pergunta.
2. **Briefing matinal:** job 7h40 dispara → código coleta agenda (Calendar), 3 prioridades e primeiro micropasso → Sonnet redige com formulação variada (fallback: template determinístico com os mesmos dados) → envio com delay aleatório + sendPresence → entrega confirmada pós-2xx e registrada.
3. **Compromisso → cadeia de lembretes:** evento criado (por frase, foto ou Calendar) → gerador determinístico expande em reminders (véspera / manhã / "hora de sair" com deslocamento) na tabela `jobs` → scheduler (poll 30s) dispara cada um por template sem LLM → confirmação pós-2xx, retry, alerta se esgotar.
4. **Fechamento de loop:** prazo vencido → job de cobrança → mensagem neutra com menu 1/2/3 (respeitando teto diário) → resposta numérica resolvida pelo executor determinístico → "2" gera proposta de horário baseada em patterns → status atualizado + reconhecimento imediato se "feito".
5. **Conversa com ação:** mensagem → triagem Haiku (captura | comando | conversa | agenda) → comandos e capturas resolvem sem Sonnet (~40–50% dos turnos) → conversa real vai ao Sonnet com prompt cacheado + tools strict → toda escrita passa pelo task-store, nunca pela "memória" do modelo.
6. **Retorno pós-sumiço:** 48h sem resposta → supressor ativa (cobranças seguradas, proatividade mínima) → primeira mensagem do usuário → UM resumo compacto de reentrada, sem decisões exigidas → volume normal retomado gradualmente.
7. **Falha de infraestrutura:** sessão Baileys cai → `CONNECTION_UPDATE` → watchdog envia e-mail com instrução de re-scan do QR; VPS inteiro morre → ping do brain para → Healthchecks.io alerta por e-mail; lembrete esgota retries → e-mail. Nenhum caminho de falha termina em silêncio.
8. **Consolidação noturna (M2):** job destila a conversa do dia via Batch API (Haiku, 50% off) → facts com confidence atualizados → bloco markdown regenerado → entra no system prompt cacheado do dia seguinte; patterns agregados calibram horários e volume da proatividade (M3).

---

## 7. Métricas de Sucesso

| Métrica | Meta |
|---|---|
| Adesão de longo prazo (a métrica-norte) | Uso ativo (≥ 1 interação/dia útil) aos 6 meses; sobreviver a ≥ 3 ciclos de sumiço-e-retorno sem abandono |
| Confiabilidade percebida | ≥ 99,5% dos lembretes entregues (confirmação pós-2xx) no horário ±2 min; zero lembretes perdidos em restart; zero dias com falha silenciosa |
| Atrito de captura | 100% das capturas confirmadas em ≤ 15s sem nenhuma pergunta de estrutura; ≥ 70% das capturas semanais por áudio ou texto solto (sinal de que o hábito pegou) |
| Sobrevivência ao sumiço | Após cada janela de silêncio ≥ 48h, retorno à interação em ≤ 7 dias e reentrada com exatamente 1 mensagem de resumo (nunca pilha de cobranças) |
| Valor por mensagem proativa | Taxa de resposta às proativas ≥ 60% na média de 30 dias; ≤ 6 proativas/dia; contato jamais silenciado no WhatsApp |
| Fechamento de loop | ≥ 80% das cobranças respondidas com 1/2/3 em 24h; lista sem itens com > 21 dias parados sem decisão |
| Custo | ≤ US$32/mês total; `cache_read_input_tokens` > 0 em ≥ 95% das chamadas ao Sonnet; ≥ 40% dos turnos resolvidos sem Sonnet |
| Saúde operacional | Downtime detectado em ≤ 5 min (dead man's switch); restauração de backup testada a cada milestone; sessão WhatsApp recuperada em ≤ 12h após queda |

---

## 8. Roadmap

| Fase | Escopo | Estimativa |
|---|---|---|
| M1 — Núcleo confiável (MVP) | RF-01..RF-15: infra (VPS, Docker, Evolution 2.3.7, Caddy, Litestream, Healthchecks.io), captura texto+áudio, task-store, scheduler durável, cadeias de lembrete, briefing e revisão com fallback, executor determinístico, fechamento de loop, "qual a próxima?", modo retorno sem culpa, higiene da lista, Google Calendar, watchdog/alertas, tom RSD-safe com testes, monitor de custo. Valor na 1ª semana: capturar por áudio, briefing com agenda real, nunca mais perder compromisso. | 5–6 semanas (uma pessoa + IA): sem. 1 infra + Evolution + adapter; sem. 2–3 task-store + scheduler + captura + cadeias; sem. 4–5 rituais + loop + Calendar + modo retorno; sem. 6 hardening, testes de falha injetada e de tom, restore de backup |
| M2 — Destravar e conhecer | RF-16..RF-23: foto/print e encaminhamento viram compromisso (vision), micropassos e "só 5 minutos", if-then contextualizado, memória de longo prazo (facts + Batch API), sessões de foco, planejamento por energia, Gmail no briefing, planejamento por capacidade real. | 3–4 semanas, começando após ≥ 2 semanas de uso real do M1 (o uso calibra prioridades e prompts) |
| M3 — Adaptar e centralizar | RF-24..RF-29: proatividade adaptativa por patterns, boletos por foto, integração com ferramenta de trabalho, retrospectiva mensal, canal de contingência Telegram testado, checklist de preparação nos alertas de saída. | 4–6 semanas, intercaladas com operação — itens independentes, entregáveis um a um conforme o uso pedir |
| Operação contínua | Ajuste de prompts por feedback real, revisão do formato do briefing quando a taxa de resposta cair (anti-habituação), upgrade testado da Evolution, teste trimestral do adapter Telegram, restore de backup a cada milestone. | ~2–4 h/semana em regime permanente |

Critério de saída do M1: uma semana de operação com 100% de entrega de lembretes antes de iniciar o M2.

---

## 9. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Banimento do número WhatsApp (Baileys não-oficial; risco subiu em 2025/26) | Chip secundário dedicado e aquecido (nunca o principal), < 50 msgs/dia, delays aleatórios 10–45s + sendPresence, conteúdo variado, dados 100% no SQLite próprio (trocar chip = minutos) e adapter Telegram dormente testado trimestralmente |
| Queda silenciosa da sessão Baileys (loop de QR, 401 device_removed) — assistente "morto" sem ninguém perceber | Watchdog em `CONNECTION_UPDATE` + dead man's switch externo (Healthchecks.io) + e-mail com instrução de re-scan; pin de versão com upgrade só após teste; meta de recuperação ≤ 12h |
| Excesso de proatividade → habituação → usuário silencia o contato (morte terminal do produto) | Teto duro de ~6 proativas/dia em settings desde o M1, formulação variada obrigatória, toda proativa pede resposta acionável, agrupamento em digest, proatividade adaptativa no M3 |
| Uma cobrança com tom crítico custa semanas de confiança (RSD) | Regras de tom hard-coded no system prompt (proibido histórico de falhas), suite de regressão de tom com exemplos adversariais no CI, opção "dropar" em toda cobrança, `adiamentos_count` nunca exibido |
| Custo de API descontrolado (invalidação silenciosa do cache multiplica 5–10x; fim do preço introdutório do Sonnet 5 em 31/08/2026) | System prompt byte-estável com data na última mensagem, alarme de cache_read=0, triagem Haiku (≥ 40% dos turnos sem Sonnet), janela deslizante + resumo, templates sem LLM, monitor com alerta em US$25 e orçamento já no preço cheio |
| MVP inchado atrasa a estreia ou estreia instável | Foto/vision movida para M2; M1 sequenciado com infra primeiro e hardening dedicado na última semana; critério de saída do M1 explícito |
| Perda de lembretes em restart/deploy ou falha de entrega não percebida | Jobs persistidos no SQLite com catch-up no boot (testado), entrega confirmada só pós-2xx, retry exponencial, alerta por e-mail ao esgotar retries |
| Licença da Evolution 2.4.0+ (gratuita, mas com ativação obrigatória: cadastro, telemetria e servidor de licenças disponível no boot) | Pin na última estável (2.3.7); adoção da 2.4.x só quando estável e após teste em paralelo incluindo cenário de servidor de licenças indisponível (ADR-002); adapter reduz migração para WAHA/fork/Telegram a dias |
| Alucinação de compromissos se o LLM virar registro | Task-store determinístico como única fonte da verdade; escrita só via tools strict validadas no backend; scheduler nunca depende de resposta do modelo para disparar |
| Integração Google quebrando em silêncio (refresh token expira em modo Testing) | App OAuth publicado "In Production" desde o início, escopos mínimos, monitoramento de falha de refresh com alerta por e-mail, token cifrado |
| Dependência de terceiro no funil de voz (Groq muda preço/limites) | Interface de STT isolada com fallback OpenAI Whisper (~US$0,006/min) — a entrada de primeira classe nunca depende de um único fornecedor |
| Novidade que passa (lacuna nº 1 dos apps TDAH: motivação além das primeiras semanas) | Variação de formulação, ajuste por feedback explícito ("menos mensagens de manhã"), revisão do formato do briefing quando a taxa de resposta cair, retrospectiva mensal com UMA sugestão de ajuste |
| Manutenção de longo prazo por uma pessoa só | Monolito, uma linguagem, uma persistência, dependências mínimas pinadas, restore de backup testado a cada milestone — mantibilidade em 2 anos como critério de toda decisão |
| Posicionamento clínico indevido ou dependência sem senso crítico | Enquadramento explícito como ferramenta de suporte de função executiva, complementar a tratamento; sem linguagem clínica; design evita criar ansiedade de checagem |

**Custo mensal estimado:** US$18–32/mês, orçado no preço cheio do Sonnet 5 (pós-31/08/2026): VPS 2GB US$5–9 · API Anthropic US$10–20 (Haiku + Sonnet com caching + Batch API noturna) · STT Groq < US$1 · backup Backblaze B2 < US$1 · Healthchecks.io e Litestream grátis · chip pré-pago dedicado ~R$15.

---

## 10. Fundamentos de design para TDAH (referência transversal)

Estas táticas são a razão de ser do produto e valem como critério de review em toda entrega:

- Captura sem nenhuma micro-decisão — estrutura-se depois, em silêncio (RF-01, RF-02, RF-16).
- O assistente sempre puxa a interação; nada depende de o usuário lembrar de abrir algo (RF-03..RF-06).
- Tempo externalizado por cadeia, não alarme único; sempre "quanto falta", não só "quando" (RF-04, RF-25).
- Dosagem: teto de 3 prioridades; resposta padrão é UMA próxima ação; backlog só sob pedido (RF-05, RF-09).
- Tom RSD-safe testado no CI; zero mecânica punitiva; dropar sem culpa é feature de primeira classe (RF-08, RF-11, RF-14).
- Dopamina no momento certo: reconhecimento imediato de cada conclusão (RF-07, RF-14).
- O assistente formula o plano (micropassos, "só 5 minutos", if-then situado no dia real) — o déficit está em iniciar, não em executar (RF-17, RF-18).
- Robustez ao engajamento inconsistente: o retorno pós-sumiço tem atrito zero (RF-10).
- Confiabilidade é tática comportamental: lembrete que não chega destrói a confiança de uma vez (RF-03, RF-13).
- Ferramenta complementar a tratamento, nunca substituto (tom geral).

---

*Documentos relacionados: [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [TESTING.md](TESTING.md)*
