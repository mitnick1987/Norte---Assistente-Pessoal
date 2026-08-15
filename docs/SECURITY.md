# Segurança — {{PROJETO}}

**Versão:** 0.1 · **Data:** {{DATA}} · Baseline: defina o baseline de referência (ex.: OWASP ASVS L2) · Referências: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 1. Autenticação

Tabela item → padrão: algoritmo e parâmetros de hash de senha, política de senha (tamanho mínimo + checagem contra listas vazadas, sem regras arbitrárias de composição), tempo de vida e armazenamento de sessão/tokens (rotação de refresh, detecção de reuso), MFA e para quem é obrigatório, verificação de e-mail, anti-abuso de login (rate limit por IP e por conta, lockout progressivo, sem enumeração de usuários). Parâmetros escritos aqui são contrato — mudar exige revisão de segurança.

| Item | Padrão |
|---|---|
| … | … |

## 2. RBAC

Papéis e permissões em tabela permissão × papel, com o escopo de cada papel. Permissões nomeadas como `recurso:ação`. Autorização em duas camadas — guards na aplicação e imposição no banco — quando a stack permitir. A matriz completa aqui evita permissão inventada ad hoc no código.

| Permissão | papel A | papel B | … |
|---|:-:|:-:|:-:|
| … | … | … | … |

Regras de ouro:

- Limites de negócio são impostos e re-validados no backend, nunca só na UI.
- Toda checagem negada gera log (nível `warn`) com actor + permissão + recurso.
<!-- ADAPTE: acrescente as regras de ouro do domínio deste projeto — em especial quais papéis jamais recebem quais permissões. -->

## 3. Isolamento de Dados

Se há dados de múltiplos clientes/organizações: descreva como o isolamento é garantido no nível do banco (ex.: políticas de row-level security com contexto setado por request), quais tabelas são cobertas e as políticas-modelo em SQL. A conexão da aplicação não pode ter privilégio de contornar as políticas; migrações usam role separada.

Obrigatório no CI: testes de isolamento — usuário do cliente A não lê dados do cliente B; anônimo só lê o que é público. Toda tabela nova com dado de cliente nasce com isolamento habilitado + política + teste. Suites em [TESTING.md](TESTING.md).

## 4. Secrets Management — nenhuma senha em código

Tabela regra → implementação: zero secrets no repositório (scanner no pre-commit e no CI, com build falhando), secrets de runtime (secret store da infra), secrets de CI/CD escopados por ambiente e mascarados em log, separação config vs. secret (`.env.example` versionado só com as chaves, sem valores — documente exceções de dev local, se houver), validação de presença/formato das variáveis no boot com falha rápida, rotação de chaves de assinatura, credenciais distintas por role de banco, redação automática de campos sensíveis nos logs.

| Regra | Implementação |
|---|---|
| … | … |

## 5. Borda e Rede

Como o tráfego chega à origem, recurso a recurso: TLS mínimo e HSTS, WAF (regras gerenciadas + custom), mitigação de bots, rate limiting por rota com números concretos (login, cadastro, rotas de escrita, rotas públicas), proteção da origem (aceitar tráfego apenas do proxy/borda, nada de acesso direto ao IP), headers de resposta (CSP estrita sem `unsafe-inline`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` mínima).

Defesa em profundidade: a borda protege por IP; o backend repete o rate limit por identidade (usuário/organização).

## 6. Proteções de Aplicação

- Validação de entrada em 100% das rotas, com esquema compartilhado entre client e server.
- Acesso a dados sempre parametrizado — nunca concatenação de SQL; saída escapada por padrão, com CSP como segunda camada.
- Identificadores não enumeráveis + autorização por recurso (anti-IDOR); tokens compartilháveis com entropia alta e revogáveis.
- Política de dependências: lockfile obrigatório, atualização automatizada, audit no CI com gate por severidade.
<!-- ADAPTE: liste aqui as proteções específicas do domínio deste projeto. Exemplos reais de outros projetos: parser próprio com whitelist para expressões vindas do usuário (nunca eval); upload validado por magic bytes, re-encodado e servido de domínio sem cookies; sanitização server-side de conteúdo customizável por terceiros; estratégia de CSRF conforme o modelo de sessão. -->

## 7. Security Audit — contínuo e por release

**No CI (todo PR):** liste os scanners com gate de build — SAST, secret scanning, dependency audit, scan de imagens/containers, e as suites obrigatórias de isolamento e RBAC.

**Por release/período:** DAST contra staging, revisão manual do checklist do baseline nas áreas alteradas, pentest externo antes do go-live e recorrente depois, revisão periódica de acessos (staff, chaves, tokens de CI, contas inativas).

**Trilha de auditoria:** o que é registrado (quem, quando, o quê/diff, origem), garantia de append-only também no banco (grants/políticas, não só convenção) e prazo de retenção.

## 8. LGPD

Se o sistema trata dados pessoais: minimização (quais dados e por quê), base legal por finalidade (consentimento separado para marketing), papéis de controlador/operador e contratos de tratamento com terceiros, direitos do titular (exportação e exclusão self-service, com o que é preservado por obrigação legal e anonimização do restante), localização dos dados e criptografia de backups com retenção definida, runbook de incidente com prazos da ANPD e contato do encarregado (DPO) publicado.
