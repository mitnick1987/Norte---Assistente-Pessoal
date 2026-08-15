# Arquitetura — {{PROJETO}}

**Versão:** 0.1 · **Data:** {{DATA}} · Referências: [PRD.md](PRD.md) · [SECURITY.md](SECURITY.md) · [TESTING.md](TESTING.md)

Stack: **{{STACK_FRONTEND}} (frontend) · {{STACK_BACKEND}} (backend) · {{BANCO}} · {{INFRA}}**.

Declare a stack em uma linha, aqui no topo. Toda escolha técnica com impacto duradouro precisa de ADR em [docs/adr/](adr/) antes da implementação (ver §7).

---

## 1. Visão de Contêineres (C4 — nível 2)

Diagrama (mermaid) mostrando atores, borda, aplicações, banco, cache/filas e observabilidade, com as setas de comunicação. É o mapa que um dev novo lê primeiro — sem ele, cada pessoa imagina uma topologia diferente.

```mermaid
flowchart TB
    %% preencher: atores -> borda -> apps -> dados
```

Decisões-chave:

Liste em bullets as 2–4 decisões estruturais que explicam o diagrama (ex.: deployment único vs. instância por cliente; backend stateless; trabalho pesado em fila, nunca no request).

---

## 2. Estrutura do Repositório e Módulos (arquitetura modular)

Árvore de diretórios comentada (código da aplicação, docs, infra — se o projeto for um monorepo, também apps e packages compartilhados), com uma linha por módulo dizendo sua responsabilidade. Em seguida, as regras de dependência entre módulos — idealmente garantidas por lint de fronteiras, não por disciplina:

- Pacotes de domínio puro não importam nada de app — 100% testáveis.
- Módulos se comunicam por interfaces exportadas, nunca por acesso direto aos internos de outro módulo.
- Preocupações transversais (auditoria, logging) entram por interceptor/middleware, não "à mão" em cada módulo.

---

## 3. Modelo de Dados (ER)

Diagrama ER (mermaid) das entidades centrais com campos-chave e enums de estado. Depois, "pontos de atenção": constraints não óbvias, campos imutáveis (snapshots), decisões de modelagem que alguém vai querer "simplificar" no futuro — documentar aqui evita a regressão.

```mermaid
erDiagram
    %% preencher: entidades centrais e relacionamentos
```

### 3.1 Isolamento de dados

Se o sistema guarda dados de mais de um cliente/organização: tabela ator → o que enxerga, e como o isolamento é garantido no nível do banco, não só na aplicação. Políticas completas em [SECURITY.md](SECURITY.md#3-isolamento-de-dados).

---

## 4. Núcleo de Domínio (pacotes puros)

Descreva a lógica de negócio crítica como pacote puro, sem I/O — testável isoladamente e, se o projeto for um monorepo, reutilizável entre apps quando fizer sentido. Diagrama de classes das abstrações centrais e a regra de extensão: caso novo do domínio = nova implementação da interface, sem modificar o existente. Deixe claro o que o servidor sempre recalcula em vez de confiar no cliente.

### 4.1 Sequência — fluxo crítico de escrita

Um diagrama de sequência (mermaid) por fluxo de escrita crítico, mostrando onde acontecem autenticação/autorização, validação, a regra de negócio central (que o servidor sempre recomputa) e a persistência. Torna visível quem é a fonte de verdade em cada passo.

### 4.2 Sequência — outros fluxos relevantes

Repita o formato para os demais fluxos que envolvem múltiplos contêineres (resolução por request, cache com invalidação, jobs assíncronos).

---

## 5. API — princípios

Defina e justifique: versionamento das rotas, formato padrão de erro (com correlation-id), paginação, idempotência em POSTs críticos, o que é público/cacheável vs. autenticado, e validação de contrato compartilhada entre client e server. Estes princípios valem para todas as rotas — exceção pede ADR.

---

## 6. Error Reporting e Observabilidade

Como erros de frontend, backend e workers chegam a alguém: error tracking com release e contexto (sem PII), logs estruturados com correlation-id, retry/backoff e DLQ para jobs, e alertas com limiares (taxa de 5xx, latência p95, fila represada). Erro que ninguém vê não existe até virar incidente.

---

## 7. ADRs resumidas

Tabela # → decisão → motivo, com link para o arquivo em [docs/adr/](adr/). A tabela é só o índice; contexto, alternativas e consequências vivem no ADR. Registre a decisão antes de implementar, via `/adr`.

| # | Decisão | Motivo |
|---|---|---|
| … | … | … |
