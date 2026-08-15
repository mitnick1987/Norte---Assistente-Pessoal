# Como usar este template

Guia de adoção. O nome é `COMO-USAR.md` de propósito, para não conflitar com o `README.md` do seu projeto. Quando terminar a adoção, apague este arquivo.

## 1. O que é (e o que não é)

Este template é um **processo de desenvolvimento pronto**: documentação de fundação (PRD, arquitetura, segurança, testes), processo de trabalho (fluxo de feature, Definition of Done, commits, releases), um time de agentes para o Claude Code (`.claude/agents/`), as skills que orquestram o fluxo (`.claude/skills/`) e um workflow de review multi-agente (`.claude/workflows/`). Tudo já amarrado: as skills acionam os agentes, os agentes referenciam os docs, o CI cobra os gates que os docs definem.

O que ele **não** é:

- **Não tem código de aplicação.** Nenhum framework, nenhuma dependência, nenhum scaffold de app. A stack é sua — o template só exige que você a declare em `docs/ARCHITECTURE.md` e a respeite nos gates.
- **Não é plug-and-play.** Os docs são esqueletos com instruções de preenchimento; o `ci.yml` falha de propósito até receber os comandos reais; há dezenas de blocos `ADAPTE` esperando decisões suas.
- **Não depende do Claude Code para valer.** Os documentos de `docs/process/` descrevem o processo de forma independente de ferramenta; `.claude/` é a automação por cima.

## 2. Árvore de arquivos

```
.
├── COMO-USAR.md                   este guia — apague ao terminar a adoção
├── CLAUDE.md                      contexto de sessão do Claude Code: regras inegociáveis, processo, time
├── README.md                      porta de entrada do repo: descrição, índice de docs, setup local
├── CONTRIBUTING.md                onboarding: ordem de leitura, o essencial do processo, setup
├── CHANGELOG.md                   Keep a Changelog + SemVer; toda entrega adiciona em [Não lançado]
├── .env.example                   só as CHAVES das variáveis de ambiente, sem valores — nenhum secret commitado
├── .editorconfig                  base editorial agnóstica de stack: UTF-8, LF, indentação, newline final
├── .gitattributes                 fim de linha LF em qualquer SO — par do .editorconfig
├── .gitignore                     garante que .env nunca entra no git; diretórios da stack via ADAPTE
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── feature.md             campos exigidos de uma FEAT: contexto, escopo, fora de escopo, validação
│   │   ├── bug.md                 campos exigidos de um BUG: esperado, observado, reprodução, ambiente
│   │   └── config.yml             desabilita issue em branco — toda issue nasce de um template
│   ├── PULL_REQUEST_TEMPLATE.md   descrição de PR + checklist do Definition of Done
│   └── workflows/
│       └── ci.yml                 esqueleto de CI — cada step marcado com ADAPTE falha (exit 1) até ser preenchido
├── .claude/
│   ├── settings.json              permissões do Claude Code: allowlist de leitura; bloqueia ler .env e force-push
│   ├── agents/
│   │   ├── backend-dev.md         implementa API, domínio, banco e migrações (sonnet)
│   │   ├── frontend-dev.md        implementa telas, fluxos e componentes (sonnet)
│   │   ├── qa-engineer.md         planeja e escreve testes; guardião da suite de segurança (sonnet)
│   │   ├── code-reviewer.md       revisa qualidade/arquitetura de todo PR; só lê, não edita (opus)
│   │   ├── security-auditor.md    audita diffs sensíveis (auth, isolamento, secrets); só lê (opus)
│   │   ├── tech-writer.md         specs, seção Entrega, CHANGELOG, ADRs, guias (sonnet)
│   │   └── devops-engineer.md     CI/CD, containers, borda, observabilidade, backups (sonnet)
│   ├── skills/
│   │   ├── feature/SKILL.md       /feature — spec → branch → implementação → review → doc → PR
│   │   ├── bugfix/SKILL.md        /bugfix — teste que reproduz → causa raiz → registro
│   │   ├── adr/SKILL.md           /adr — registro de decisão de arquitetura
│   │   ├── release/SKILL.md       /release — fecha CHANGELOG, tag SemVer, release notes
│   │   └── handoff/SKILL.md       /handoff — fotografia do estado real do projeto para outro dev assumir
│   └── workflows/
│       └── review-feature.js      review multi-agente: reviewers em paralelo + verificação adversarial dos achados
└── docs/
    ├── PRD.md                     esqueleto do produto: problema, personas, RFs, métricas, roadmap
    ├── ARCHITECTURE.md            esqueleto da arquitetura: C4, módulos, ER, API, observabilidade, índice de ADRs
    ├── SECURITY.md                esqueleto de segurança: auth, RBAC, isolamento, secrets, borda, LGPD
    ├── TESTING.md                 pirâmide de testes, suite de segurança S1–S6, gates de CI
    ├── adr/
    │   └── _TEMPLATE.md           modelo de ADR — usado a cada decisão, não é doc de instanciação
    ├── features/
    │   ├── _EXEMPLO-confirmacao-email.md  spec preenchida de exemplo — referência de calibre; não conta na numeração
    │   └── _TEMPLATE.md           modelo de spec de feature — usado a cada FEAT-NNN
    └── process/
        ├── DEVELOPMENT_PROCESS.md fluxo de feature, Definition of Done, commits, branches, papéis do time
        └── CODE_STYLE.md          idioma, tipos, regra de comentários (só porquês), convenções por camada
```

## 3. Passo a passo de adoção

1. **Copie o conteúdo desta árvore para a raiz do projeto novo.** Inclua os diretórios ocultos `.claude/`, `.github/` e os dotfiles da raiz — são metade do valor do template. Não copie o diretório `.git/`: ele é o histórico do template, não do projeto novo (criando via "Use this template" no GitHub isso já é automático).
2. **Substitua os placeholders** (tabela na seção 4). Busca: `grep -rn "{{" . --include="*.md" --include="*.yml"`. Atenção: o `description:` no frontmatter dos agentes e das skills contém `{{PROJETO}}` — se ficar sem substituir, o placeholder aparece na interface do Claude Code.
3. **Revise os blocos `ADAPTE`** (lista na seção 5). Cada um pede uma decisão do projeto: regras de domínio, áreas sensíveis, comandos, gates. Resolva preenchendo o conteúdo e removendo o comentário.
4. **Preencha `CLAUDE.md` e `README.md`** (nome, descrição e regras inegociáveis do domínio — boa parte sai dos passos 2 e 3) **e depois os esqueletos de docs, nesta ordem** — cada um alimenta o seguinte:
   1. `docs/PRD.md` — problema, personas, requisitos funcionais, roadmap. É a fonte do "o quê" e do "por quê"; nada se implementa antes dele.
   2. `docs/ARCHITECTURE.md` — declare a stack na linha do topo, desenhe os diagramas C4/ER e registre as primeiras ADRs (a escolha da stack já merece uma).
   3. `docs/SECURITY.md` — parâmetros de auth, matriz RBAC, estratégia de isolamento, regras de secrets e borda. O que fica escrito aqui é contrato.
   4. `docs/TESTING.md` — ferramentas concretas, módulos críticos com gate de cobertura, cenários extras da suite de segurança (S7 em diante), fluxos E2E.
   5. Depois: `docs/process/` e `CONTRIBUTING.md` (glossário, convenções da stack, comandos de setup), `.claude/` (áreas sensíveis nos blocos ADAPTE; em `settings.json`, acrescente ao `allow` os comandos read-only da stack — rodar testes, lint), `.gitignore` (diretórios de dependências e build da stack), `.env.example` (as chaves reais das variáveis de ambiente — só as chaves, sem valores) e, por último, `.github/workflows/ci.yml` — os steps marcados falham de propósito até receberem os comandos reais.
5. **Configure o repositório no GitHub** — o processo exige `main` protegida, PR obrigatório e squash merge; sem isso, as regras dos docs são só texto:

   ```sh
   # squash como único modo de merge; branch apagada ao mergear
   gh repo edit --enable-squash-merge --delete-branch-on-merge \
     --enable-merge-commit=false --enable-rebase-merge=false

   # main protegida: CI verde como gate e PR obrigatório
   printf '%s' '{"required_status_checks":{"strict":true,"contexts":["Lint, typecheck, testes e build","Gates de segurança"]},"enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null}' \
     | gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" --input -
   ```

   Os dois `contexts` são os `name` dos jobs do `ci.yml` — se renomear os jobs, atualize aqui. A aprovação humana fica em `0` de propósito: o review do processo é dos agentes (com Opus) e o gate duro é o CI; suba o número quando houver mais de um dev no repositório.
6. **Verifique:** `grep -rn "ADAPTE\|{{" . --include="*.md" --include="*.yml" --include=".env.example" --include=".gitignore"` deve voltar vazio (fora os `_TEMPLATE.md` e o literal `AAAA-MM-DD` deles, que é preenchido a cada ADR/feature, não na adoção). Confira que os links relativos entre os docs resolvem.
7. **Apague `COMO-USAR.md`.** Primeiro commit sugerido: `chore: instancia template do processo de desenvolvimento`.

Não mude a política de modelos dos agentes (seção 6) durante a adoção — ela é regra do processo, não configuração de gosto.

## 4. Placeholders

Todos os placeholders de instanciação presentes na árvore:

| Placeholder | Significado | Onde aparece |
|---|---|---|
| `{{PROJETO}}` | Nome do projeto | Quase todos os arquivos: `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `docs/*.md`, `docs/process/*.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.github/workflows/ci.yml` |
| `{{DESCRICAO}}` | Descrição de uma linha do produto | `CLAUDE.md`, `README.md` |
| `{{DATA}}` | Data de instanciação do doc (AAAA-MM-DD) | Cabeçalhos de `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TESTING.md`, `docs/process/DEVELOPMENT_PROCESS.md`, `docs/process/CODE_STYLE.md` |
| `{{STACK_BACKEND}}` | Framework/linguagem do backend | `docs/ARCHITECTURE.md`, `docs/process/CODE_STYLE.md`, `.claude/agents/backend-dev.md` |
| `{{STACK_FRONTEND}}` | Framework do frontend | `docs/ARCHITECTURE.md`, `docs/process/CODE_STYLE.md`, `.claude/agents/frontend-dev.md` |
| `{{BANCO}}` | Banco de dados | `docs/ARCHITECTURE.md`, `docs/process/CODE_STYLE.md`, `.claude/agents/backend-dev.md` |
| `{{INFRA}}` | Infra/hospedagem/borda | `docs/ARCHITECTURE.md` |

## 5. Blocos ADAPTE

Localize tudo de uma vez:

```sh
grep -rn "ADAPTE" . --include="*.md" --include="*.yml" --include=".env.example" --include=".gitignore"
```

O que cada arquivo pede:

| Arquivo | Blocos | O que decidir |
|---|---|---|
| `CLAUDE.md` | 3 | Descrição do produto; autorização (ou não) de merge automático; regras inegociáveis do domínio |
| `README.md` | 2 | Descrição do produto; comandos reais de setup local |
| `CONTRIBUTING.md` | 1 | Comandos reais de setup local (em sincronia com o README) |
| `docs/SECURITY.md` | 2 | Regras de ouro do RBAC do domínio; proteções de aplicação específicas |
| `docs/TESTING.md` | 7 | Ferramentas concretas por camada; módulos críticos com gate de cobertura; rotas/jobs de integração obrigatórios; cenários extras da suite de segurança; fluxos E2E; metas de carga; ferramentas de scan e estratégia de deploy |
| `docs/process/CODE_STYLE.md` | 4 | Glossário do domínio; regras inegociáveis; convenções da stack de frontend; regra de isolamento em tabela nova |
| `docs/process/DEVELOPMENT_PROCESS.md` | 2 | Áreas sensíveis que disparam o security-auditor; autorização de merge automático |
| `.claude/agents/backend-dev.md` | 1 | Regras inegociáveis do domínio no backend |
| `.claude/agents/frontend-dev.md` | 1 | Regras inegociáveis do frontend |
| `.claude/agents/qa-engineer.md` | 2 | Nome/local da suite de segurança do projeto; módulos críticos e limiares de cobertura |
| `.claude/agents/security-auditor.md` | 2 | Áreas sensíveis do domínio (gatilhos da auditoria); verificações específicas no checklist |
| `.claude/agents/devops-engineer.md` | 1 | Infra concreta e ferramentas de varredura dos gates |
| `.claude/skills/feature/SKILL.md` | 2 | Áreas sensíveis extras no review; autorização de merge automático |
| `.claude/skills/bugfix/SKILL.md` | 1 | Áreas sensíveis que exigem security-auditor no review de fix |
| `.claude/skills/release/SKILL.md` | 1 | Gatilho real do pipeline de produção, se não for tag |
| `.env.example` | 1 | Chaves reais das variáveis de ambiente (só as chaves, sem valores) — marcador em comentário `#`, não HTML |
| `.gitignore` | 1 | Diretórios de dependências e build da stack (o bloco de segurança do `.env` já vem pronto) |
| `.github/PULL_REQUEST_TEMPLATE.md` | 1 | Itens de checklist das regras do domínio |
| `.github/workflows/ci.yml` | todos os steps | Comando real de cada gate (setup, install, lint, typecheck, testes, build, secret scanning, audit) — cada step não adaptado falha com `exit 1` |

## 6. O dia a dia depois de adotado

Toda mudança nasce de uma issue (`FEAT-NNN` ou `BUG-NNN`; templates prontos em `.github/ISSUE_TEMPLATE/`, issue em branco desabilitada) e passa pelo fluxo de uma skill — nada de improvisar o processo:

- **`/feature`** — o fluxo principal: spec em `docs/features/` (tech-writer) → branch `feature/FEAT-NNN-slug` → implementação com testes (backend-dev/frontend-dev + qa-engineer) → review obrigatório (code-reviewer sempre; security-auditor quando o diff toca auth, permissões, dados sensíveis, upload ou env) → seção Entrega + CHANGELOG → PR → squash merge com CI verde e reviews resolvidos.
- **`/bugfix`** — primeiro um teste que falha exatamente pelo bug, depois a correção da causa raiz (nunca do sintoma), registro em `Corrigido` no CHANGELOG e, se o bug revelou lacuna de teste/processo, a lacuna se corrige no mesmo PR.
- **`/adr`** — registra decisão de arquitetura antes de implementar. Regra prática: se daqui a 6 meses alguém perguntaria "por que fizeram assim?", é ADR. Entra em `docs/adr/` e na tabela do `ARCHITECTURE.md`.
- **`/release`** — fecha `[Não lançado]` numa versão SemVer, cria tag anotada e release notes; a tag dispara o deploy de produção conforme o pipeline do `TESTING.md`.
- **`/handoff`** — gera `docs/HANDOFF.md` a partir do estado real do repositório (não do que os docs dizem): o que está pronto, em andamento, decisões pendentes, como rodar, débitos e armadilhas.

**Workflow de review:** quando a ferramenta Workflow do Claude Code está disponível, a etapa de review de `/feature` e `/bugfix` roda pelo workflow salvo `review-feature` (`.claude/workflows/review-feature.js`): ele decide se o security-auditor entra lendo os gatilhos do próprio agente (por isso não tem bloco ADAPTE — a lista mora só em `security-auditor.md`), roda os reviewers em paralelo e tenta refutar cada achado antes de reportar — só o que sobrevive à verificação chega para correção. Sem a ferramenta, as skills seguem o roteiro manual equivalente; o resultado exigido é o mesmo.

**Definition of Done** de toda entrega: código + testes verdes + doc da feature (com seção Entrega) + CHANGELOG. Faltou um, a entrega não existe.

**Política de modelos:** implementadores (backend-dev, frontend-dev, qa-engineer, tech-writer, devops-engineer) rodam com Sonnet; code-reviewer e security-auditor rodam com Opus — definido no frontmatter de cada agente. O review nunca roda em modelo menor que Opus e nunca é pulado por indisponibilidade de modelo.

## 7. Manter o template vivo

A pasta do template é um repositório git próprio: toda melhoria de processo (agente novo, regra nova, ajuste de skill) vira commit aqui, com o mesmo padrão de mensagens do processo. Para instanciar projetos com um clique, publique como template repository no GitHub:

```sh
gh repo create project-template --private --source . --push
gh repo edit --template
```

Projetos novos passam a nascer via "Use this template" (com `.git/` novo e limpo). Projetos já instanciados não recebem atualização automática — ao evoluir o processo dentro de um projeto, avalie portar a mudança para cá.
