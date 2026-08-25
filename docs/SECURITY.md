# Segurança — Norte

**Versão:** 0.1 · **Data:** 2026-08-25 · Baseline: sem certificação formal (produto single-user, não exposto publicamente) · Referências: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 1. Autenticação

Não existe autenticação de usuário humano no sentido clássico: não há login, senha, sessão de navegador nem cadastro. O Norte é single-user (RF não-objetivo do PRD §"Não-objetivos da v1": multi-usuário/SaaS/onboarding de terceiros está fora de escopo por design). A "autenticação" do produto é a borda que decide quem pode falar com o assistente — descrita na íntegra em §2.

O único segredo de acesso ao sistema é o `AUTHENTICATION_API_KEY` da Evolution API, que autentica chamadas ao painel/API da Evolution (não a usuários). Regras:

| Item | Padrão |
|---|---|
| `AUTHENTICATION_API_KEY` | Gerado aleatoriamente (≥ 32 bytes), único por ambiente, nunca reaproveitado de exemplo/documentação |
| Exposição | A porta da Evolution API **nunca** é publicada no host; só é alcançável dentro da rede Docker interna, pelo `brain` |
| Rotação | Manual, ao trocar de VPS ou suspeita de vazamento; não há automação de rotação na v1 |
| Painel administrativo da Evolution | Não exposto à internet; acesso só via túnel SSH quando necessário |

## 2. Controle de Acesso (matriz de atores, no lugar de RBAC)

Não há papéis nem permissões no sentido de RBAC multi-usuário — não faria sentido em um sistema de uma pessoa só. O controle de acesso real do produto é **decidir quem é o dono e ignorar todo o resto**. A matriz abaixo substitui a matriz permissão × papel de um sistema multi-tenant:

| Ator | Acesso |
|---|:---|
| Dono, via WhatsApp, do JID configurado em `OWNER_WHATSAPP_JID` | Tudo: captura, comandos, leitura/escrita no task-store via conversa, todas as tools |
| Qualquer outro JID do WhatsApp (grupo, contato, número desconhecido) | Nada. Mensagem é recebida pelo webhook, comparada ao `OWNER_WHATSAPP_JID`, **ignorada e logada em `warn`** — nunca processada, nunca chega à triagem nem ao LLM |
| Processos internos (scheduler, jobs de briefing/revisão/cobrança) | Escrita no task-store exclusivamente via serviços/tools do módulo `tasks` — nunca SQL direto de outro módulo (ver [ARCHITECTURE.md §2](ARCHITECTURE.md)) |
| E-mail (SMTP/Resend) | Canal de saída apenas, unidirecional: alertas de infraestrutura para o dono. Nunca recebe comando nem aciona ação no sistema |

Regras de ouro:

- O filtro de JID é o controle de acesso principal do produto — substitui login, senha e RBAC. É imposto no backend, na entrada do webhook, antes de qualquer outro processamento (nunca depois da triagem, nunca no prompt do LLM).
- Toda mensagem de JID não autorizado gera log `warn` com o JID de origem (para investigar tentativa de spam/phishing no número), mas nenhuma resposta é enviada — silêncio total para quem não é o dono.
- Limites de negócio (teto de proativas/dia, teto de lembretes ativos, estados válidos de item/job) são impostos no task-store e no scheduler, nunca só sugeridos ao LLM via prompt — o modelo não tem autoridade para violá-los porque não tem acesso de escrita fora das tools strict.
- O LLM nunca é fonte de verdade nem executa ação fora das tools strict validadas no backend (JSON Schema `additionalProperties: false` + validação zod); ele interpreta e conversa, não decide sozinho o que grava.
- Nenhuma ação no mundo externo (enviar e-mail, fazer pagamento, responder terceiros) existe na v1 — não-objetivo explícito do PRD. O assistente só age sobre dados do próprio dono.

## 3. Isolamento de Dados

Não há dados de múltiplos clientes/organizações — sistema single-user, um único SQLite, sem multi-tenancy (ver [ARCHITECTURE.md §3.1](ARCHITECTURE.md)). Row-level security não se aplica.

O isolamento relevante aqui é de **borda**, não de banco:

- O webhook `/webhook/evolution` só aceita eventos da instância Evolution autenticada e configurada — evento de instância diferente é rejeitado.
- Mensagens de qualquer JID diferente de `OWNER_WHATSAPP_JID` são ignoradas e logadas (§2) — é o equivalente funcional de "usuário anônimo só lê o que é público", adaptado a um produto sem usuários públicos.
- Dentro do SQLite, o isolamento que existe é **entre módulos**, não entre tenants: cada módulo acessa dados de `tasks` só via serviço/tools do módulo `tasks`, nunca por SQL direto em tabela alheia (regra imposta por `eslint-plugin-boundaries`, ver [ARCHITECTURE.md §2](ARCHITECTURE.md)). Isso protege a integridade do modelo de dados, não a privacidade entre usuários.

Suite de testes correspondente: cenário "mensagem de JID não autorizado é ignorada e logada, nunca processada" é obrigatório e roda no CI (ver [TESTING.md](TESTING.md)).

## 4. Secrets Management — nenhum secret em código

| Regra | Implementação |
|---|---|
| Zero secrets no repositório | `.env` nunca commitado (`.gitignore`); só `.env.example` versionado, com as chaves e sem valores |
| Secrets de runtime | Variáveis de ambiente do container `brain`, injetadas pelo Docker Compose a partir do `.env` do host da VPS |
| `AUTHENTICATION_API_KEY` (Evolution) | Gerado por ambiente, nunca reaproveitado; ver §1 |
| Refresh token do Google (`AUTH_TOKENS.refresh_token`) | Cifrado em repouso com AES-256-GCM, chave `TOKEN_ENCRYPTION_KEY` própria no `.env` — nunca gravado em texto plano no SQLite |
| Escopos OAuth | Mínimos por milestone: `calendar.events` no M1; `gmail.readonly` acrescentado no M2. Nenhum escopo de escrita no Gmail, nenhum escopo além do necessário à feature ativa |
| Segredo do webhook Evolution | Validado em toda chamada a `/webhook/evolution` junto com o filtro de instância (§2); rejeição sem esse segredo antes de qualquer processamento |
| Logs | Proibido logar tokens, `AUTHENTICATION_API_KEY`, `TOKEN_ENCRYPTION_KEY`, conteúdo de `.env` ou qualquer secret — mesmo em `debug`. Logs estruturados (pino) carregam correlation-id, nunca segredo |
| Dependências | Lockfile obrigatório; Dependabot habilitado no repositório para atualização automatizada |

Não há credenciais distintas por role de banco (SQLite não tem esse conceito) nem rotação automatizada de chaves — ambos fora de escopo pela escala do produto (uma pessoa, um processo).

## 5. Borda e Rede

Como o tráfego chega à VPS, recurso a recurso:

- **Caddy é a única porta exposta no host** (80/443, TLS automático). Todo o resto — Evolution API, Postgres/Redis da Evolution, o processo `brain` — vive só na rede interna do Docker Compose, sem porta publicada no host.
- **A porta da Evolution API nunca é exposta.** É alcançada apenas pelo `brain`, dentro da rede Docker; a autenticação de instância usa `AUTHENTICATION_API_KEY` (§1). Não há acesso direto por IP a nenhum serviço interno.
- **Firewall do VPS:** só 80/443 (HTTP/HTTPS, redirecionado para TLS pelo Caddy) e SSH com autenticação por chave (senha desabilitada). Nenhuma outra porta aberta.
- **Superfície HTTP do `brain`:** duas rotas, ambas atrás do Caddy — `POST /webhook/evolution` (única entrada de eventos) e `GET /health` (estado dos subsistemas, consumido pelo watchdog interno e pelo ping do Healthchecks.io). Não há API pública nem rotas administrativas expostas (ver [ARCHITECTURE.md §5](ARCHITECTURE.md)).
- **Atualizações de sistema automáticas** na VPS (patches de segurança do SO aplicados sem intervenção manual).
- **Imagens de container pinadas:** Evolution API fixada em 2.3.7, a última estável (upgrade só após teste em paralelo; a eventual adoção da 2.4.x traz ativação de licença gratuita com cadastro e telemetria de metadados para a Evolution Foundation — antes de migrar, registrar essa transferência na §8/LGPD, ver ADR-002); demais imagens do Compose com tag fixa, não `latest`.
- **Dependabot** habilitado no repositório para alertar/atualizar dependências com vulnerabilidade conhecida.

Não há WAF, mitigação de bots ou CDN na frente do Caddy — desproporcional a um sistema com um único usuário legítimo e sem tráfego público. A defesa relevante contra tráfego indesejado é o filtro de JID (§2), que atua depois do TLS/Caddy, na aplicação.

## 6. Proteções de Aplicação

- **Validação de entrada em 100% das rotas e webhooks**, com zod. `POST /webhook/evolution` valida o contrato do payload antes de qualquer processamento; payload malformado é rejeitado sem tocar no task-store.
- **Idempotência por `wa_message_id`:** a Evolution reentrega webhooks; todo processamento de mensagem recebida deduplica por esse campo antes de gerar efeito (grava item, dispara job, etc.) — reentrega nunca duplica captura.
- **Mídia sempre buscada ativamente:** áudio/foto do WhatsApp é obtido via `getBase64FromMediaMessage`, nunca a partir do base64 que eventualmente venha no payload do webhook — o payload é tratado como não confiável mesmo vindo da própria Evolution autenticada.
- **Limites de negócio no backend, nunca no prompt do LLM:** teto de mensagens proativas/dia, teto de lembretes ativos, estados válidos de item/evento/job e a matriz de acesso do §2 são impostos no task-store, no scheduler e no outbox — nunca dependem de o modelo "se comportar" segundo instrução textual.
- **Tools do LLM como única superfície de escrita:** JSON Schema strict (`additionalProperties: false`) e validação zod no backend antes de qualquer gravação; o modelo nunca escreve fora desse contrato, e o servidor nunca confia em texto livre do modelo como fato (ver [ARCHITECTURE.md §4](ARCHITECTURE.md)).
- **Deleção sempre lógica** (`status: dropada`/`arquivada`), nunca `DELETE` físico — sustenta reversibilidade e trilha de auditoria (ADR-009).
- **Acesso a dados sempre parametrizado** via `better-sqlite3` (prepared statements) — nunca concatenação de SQL.
- **Política de dependências:** lockfile obrigatório, Dependabot habilitado, sem gate de severidade automatizado formalizado ainda (pendência a acompanhar quando o repositório crescer).

Não se aplicam aqui: anti-IDOR (não há recursos multi-usuário identificáveis por terceiros), CSRF (não há sessão de navegador nem formulário web), sanitização de conteúdo customizável por terceiros (não há UI nem conteúdo gerado por outros usuários) — o produto não tem essas superfícies por não ter frontend nem multi-tenancy na v1.

## 7. Security Audit

Não há pipeline de SAST/DAST/pentest formalizado — desproporcional a um produto single-user sem exposição pública além do webhook autenticado. O que existe:

**No CI (todo PR):**
- Suite de testes de segurança/isolamento obrigatória (filtro de JID, idempotência de webhook, validação de payload) — ver [TESTING.md](TESTING.md).
- Suite de regressão de tom (RSD-safe) — não é segurança de dados, mas é gate obrigatório de qualquer PR que toque mensagens ao usuário (PRD RF-14).
- Dependabot como scanner contínuo de dependências vulneráveis.

**Por milestone:**
- Restore de backup testado (Litestream → Backblaze B2) — garante que a fonte da verdade sobrevive a perda total da VPS (ver [ARCHITECTURE.md §6](ARCHITECTURE.md)).
- Revisão manual das seções deste documento quando a arquitetura mudar (ex.: ao abrir M2/M3 com Gmail e integrações de trabalho).

**Trilha de auditoria:** toda mensagem proativa tem rastro `job → outbox → 2xx → delivered_at` no SQLite (base da métrica de 99,5% de entrega do PRD §7); toda mudança de estado de item passa pelas tools do task-store, nunca por escrita solta. Não há tabela de audit log genérica separada — a trilha vive nas próprias tabelas de domínio (`jobs`, `messages`, `items`), sem prazo de retenção definido além da retenção do backup.

Pentest externo, revisão periódica de acessos e scan de imagens de container não se aplicam na v1 — não há staff, não há múltiplas contas, e a superfície exposta é mínima o bastante (uma rota de webhook autenticada) para revisão manual ser suficiente.

## 8. LGPD

O Norte trata dados pessoais — mas de uma única pessoa, o próprio dono, sobre a própria vida. Não há tratamento de dados de terceiros como atividade do produto.

- **Minimização:** os dados capturados são exatamente o que o dono envia (texto, áudio, foto) e o que o Google Calendar/Gmail expõe pelos escopos concedidos — nada é coletado além do necessário aos rituais e ao task-store (PRD §2, §4).
- **Base legal:** execução de um serviço pedido pelo próprio titular, para si mesmo — não há finalidade de marketing, não há consentimento de terceiro a obter, não há papel de controlador/operador distinto de contratos com terceiros a formalizar.
- **Transferência a operadores (processamento por APIs de terceiros):** conteúdo de mensagens e mídia é enviado a serviços externos apenas para processamento, nunca para armazenamento permanente por eles:
  - **Anthropic** (API Claude) — triagem, conversa e consolidação noturna.
  - **Groq** (Whisper large-v3-turbo) — transcrição de áudio; fallback **OpenAI Whisper**.
  - **Google** (Calendar API no M1; Gmail readonly no M2) — leitura/escrita de agenda e leitura dosada de e-mail, sob OAuth com escopos mínimos (§4).

  Nenhum desses serviços é usado para analytics, tracking ou qualquer finalidade além do processamento solicitado na própria interação.
- **Localização e backup:** dados 100% no VPS próprio (SQLite local); backup contínuo cifrado no Backblaze B2 via Litestream, sem prazo de retenção formal além do histórico contínuo de réplicas — restaurável a qualquer ponto coberto pela replicação.
- **Direitos do titular:** como o titular é o próprio operador do sistema, exportação/exclusão não têm fluxo self-service dedicado (acesso direto ao SQLite e ao backup cobre a necessidade). Deleção lógica (`dropada`/`arquivada`, nunca `DELETE` físico) preserva auditoria e reversibilidade por decisão de produto (ADR-009) — não por obrigação de retenção legal.
- **Sem analytics de terceiros:** nenhum SDK de telemetria, tracking ou analytics de terceiro roda no sistema — a única telemetria é operacional (Healthchecks.io recebe apenas um ping de liveness, sem payload de dados pessoais).
- **Encarregado (DPO) e runbook de incidente:** não há DPO formal nem runbook com prazos da ANPD — desproporcional a um sistema de dado pessoal de um único titular que é também o operador. Em caso de incidente (vazamento de backup, comprometimento da VPS), a resposta é operacional: revogar credenciais, girar `AUTHENTICATION_API_KEY` e `TOKEN_ENCRYPTION_KEY`, e restaurar de backup íntegro.
