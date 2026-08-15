# Guia de Estilo — {{PROJETO}}

**Versão:** 1.0 · **Data:** {{DATA}}

Ferramentas impõem o grosso (linter + formatter + checagem estrita de tipos no CI, conforme a stack definida em [docs/ARCHITECTURE.md](../ARCHITECTURE.md)); este guia cobre o que ferramenta não pega.

Os exemplos de código deste guia estão em TypeScript por concretude — adapte a sintaxe à linguagem do projeto. As regras valem independente de stack.

---

## 1. Idioma

- **Identificadores** (variáveis, funções, classes, tabelas, colunas, rotas): **inglês**.
- **Comentários, commits, docs, mensagens de erro ao usuário**: **português**.
- Termos de domínio têm tradução fixa (usar sempre a mesma).
  <!-- ADAPTE: liste aqui o glossário do domínio deste projeto, no formato: termo em português = `identifierEmIngles`. Uma tradução por termo, sem sinônimos. -->

## 2. Linguagem e tipos

- Modo estrito de tipos sem exceções; o tipo "coringa" da linguagem (`any` ou equivalente) é proibido (lint error) — usar o tipo desconhecido (`unknown` ou equivalente) + narrowing.
- Tipos de domínio num pacote/módulo compartilhado; o schema de validação é a fonte, o tipo é inferido dele.
- Datas em UTC no banco; formatação de fuso só na borda (UI/PDF/e-mail).
- Erros de domínio são classes próprias (`SessionExpiredError`) — nunca `throw new Error('string solta')` em código de domínio.
- Funções pequenas com nome que dispensa comentário; early return em vez de aninhamento.

<!-- ADAPTE: liste aqui as regras inegociáveis do domínio deste projeto. Exemplos reais de outros projetos: dinheiro sempre em centavos inteiros, nunca float; toda tabela com dado de cliente nasce com isolamento habilitado + teste. -->

## 3. Comentários — escreva como um dev experiente escreveria

Comentário serve para o **porquê** — restrições, trade-offs, armadilhas, contexto de negócio. O **o quê** é papel do código.

**Bom:**
```ts
// Retry só aqui: o provedor de e-mail devolve 429 em rajadas curtas
// e falhar o job inteiro por isso gera reprocessamento caro (FEAT-008).
await retryWithBackoff(() => mailer.send(message));

// O proxy de borda já limita por IP; aqui limitamos por conta porque
// um atacante com muitos IPs ainda derruba uma conta específica.
await this.rateLimiter.consume(`login:${account.id}`);
```

**Proibido:**
```ts
// Incrementa o contador           ← narra o óbvio
// Esta função calcula o total     ← redundante com o nome
// Passo 1: buscar o usuário       ← narração passo a passo
// Aqui nós vamos verificar se...  ← tom de assistente/tutorial
```

Regras:
- Se o código só fica claro com comentário, primeiro tente **reescrever o código** (extrair função com nome melhor, quebrar condição). Comentário é o último recurso, não band-aid.
- Tom natural e direto, como se escreve num time sênior. Sem emojis, sem cerimônia, sem tom didático, **sem qualquer menção a ferramenta/IA que gerou o código**.
- Comentário desatualizado é pior que nenhum: quem muda o código, muda o comentário no mesmo commit.
- `TODO` sempre com issue: `// TODO(#42): tratar fuso do cliente quando abrirmos multi-região`.
- Doc de API (JSDoc ou equivalente) só em API pública de pacote compartilhado — e só o resumo + parâmetros não óbvios; nada de boilerplate em código interno.

## 4. Backend ({{STACK_BACKEND}})

- Um módulo por contexto de domínio (ver [ARCHITECTURE.md](../ARCHITECTURE.md)); módulo não importa repositório de outro módulo — só serviço exportado.
- Controller/handler fino: valida a entrada, chama serviço, mapeia resposta. Regra de negócio mora no serviço/domínio.
- Validação de entrada em 100% das rotas; limites de negócio são impostos no backend, nunca só na UI.
- Toda rota declara guards/permissões explícitos (ex.: `@RequirePermission('user:write')`) — rota sem guard é erro de lint (allowlist só p/ rotas públicas documentadas).
- Preocupações transversais (transação, contexto de autenticação) entram via middleware/interceptor — nunca "na mão" em cada serviço.
- Nenhum secret em código ou em `.env` commitado — só `.env.example` com as chaves.

## 5. Frontend ({{STACK_FRONTEND}})

- Estilo via tokens de design centralizados (CSS custom properties ou equivalente) — componente não hard-coda valores de tema.
- Acessibilidade: componentes do design system saem acessíveis por padrão; verificação de acessibilidade no CI.
- Error boundary por rota + global (ver [ARCHITECTURE.md](../ARCHITECTURE.md)).
<!-- ADAPTE: acrescente aqui as convenções específicas da stack de frontend definida em docs/ARCHITECTURE.md (ex.: renderização no servidor por padrão, onde vive o estado, roteamento). Exemplo real de outro projeto com marca configurável: componente nunca hard-coda cor, logo ou nome de marca — tudo vem do tema. -->

## 6. Banco ({{BANCO}}) / Migrações

- Migrações versionadas, imutáveis depois de mergeadas, sempre com `down` testado.
- Nomes: `snake_case`, plural (`audit_logs`), FKs `<entidade>_id`, timestamps `created_at`/`updated_at` em todas as tabelas.
<!-- ADAPTE: se o projeto tem dado por cliente/tenant, defina aqui a regra de isolamento — tabela nova nasce com isolamento habilitado + política + teste de isolamento no mesmo PR. -->

## 7. Testes

- Nome descreve comportamento em português: `it('rejeita cadastro com e-mail já usado', ...)`.
- Arrange-Act-Assert com linha em branco entre blocos; um comportamento por teste.
- Fixtures/builders compartilhados em `test/factories` — nada de objeto gigante copiado entre testes.
- Teste que depende de ordem, hora real ou rede é bug.
