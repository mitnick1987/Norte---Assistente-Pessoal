# PRD — {{PROJETO}}

**Versão:** 0.1 · **Data:** {{DATA}} · **Status:** rascunho para revisão

Este documento é a fonte única do "o quê" e do "por quê". O "como" fica em [ARCHITECTURE.md](ARCHITECTURE.md). Nenhuma implementação começa antes de as seções abaixo estarem preenchidas e revisadas.

---

## 1. Visão Geral

Descreva em 1–2 parágrafos o que o produto é, para quem e qual valor entrega. Um leitor de fora precisa entender o produto sem abrir outro documento.

### Problema

Liste as dores concretas que motivam o projeto. Sem problema claro não há critério para cortar escopo depois.

### Solução

Liste em 3–5 itens como o produto ataca cada dor. Cada item deve mapear para um problema acima — solução sem problema correspondente é escopo suspeito.

### Não-objetivos da v1

Liste explicitamente o que fica de fora da primeira versão (e para quando fica, se houver plano). Esta lista evita scope creep e encerra discussões repetidas.

---

## 2. Decisões de Produto

Registre em tabela as decisões de negócio que moldam o sistema: modelo de operação, papéis dos atores, o que cada um pode ou não fazer, ciclos e estados relevantes. O que está escrito aqui vale como contrato entre produto e engenharia.

| Aspecto | Decisão v1 |
|---|---|
| … | … |

---

## 3. Personas

Uma linha por persona: quem é e qual a necessidade principal. Toda rota, tela e permissão do sistema deve rastrear até uma persona desta tabela.

| Persona | Descrição | Necessidade principal |
|---|---|---|
| … | … | … |

---

## 4. Requisitos Funcionais

Um bloco `RF-NN — Título` por requisito, com bullets verificáveis (nada de "o sistema deve ser flexível"). Cada RF origina uma ou mais FEAT-NNN no backlog; specs e testes referenciam o RF de origem. Estados de entidades (`draft → published`, etc.) e limites de negócio entram aqui, não só no código.

### RF-01 — …

- …

### RF-02 — …

- …

---

## 5. Requisitos Não-Funcionais

Tabela por categoria: segurança, borda/rede, disponibilidade, performance, escalabilidade, observabilidade, qualidade/testes, privacidade (LGPD, se houver dados pessoais), i18n. Cada requisito precisa de número ou critério mensurável — sem meta não há como validar a entrega. Detalhes de segurança em [SECURITY.md](SECURITY.md); gates de teste em [TESTING.md](TESTING.md).

| Categoria | Requisito |
|---|---|
| … | … |

---

## 6. Fluxos Principais

Numere os fluxos ponta a ponta mais importantes, do primeiro acesso até a entrega de valor, indicando os atores em cada passo. Estes fluxos orientam os testes E2E e a ordem do roadmap.

1. …
2. …

---

## 7. Métricas de Sucesso

Tabela métrica → meta com prazo (ex.: 6 meses pós-launch). Sem isso não dá para afirmar se o produto funcionou.

| Métrica | Meta |
|---|---|
| … | … |

---

## 8. Roadmap

Fases (M1, M2, …) com escopo e estimativa. M1 costuma ser fundação (repo, CI/CD, auth, modelo de dados); a última fase antes do launch costuma ser hardening (auditoria de segurança, E2E completo). Reserve uma linha para o que ficou para a v2.

| Fase | Escopo | Estimativa |
|---|---|---|
| … | … | … |

---

## 9. Riscos e Mitigações

Tabela risco → mitigação. Priorize riscos que invalidam o produto (vazamento de dados entre clientes, disputa sobre valores, dependência externa frágil) e amarre cada mitigação a algo verificável (teste no CI, constraint no banco, regra na borda).

| Risco | Mitigação |
|---|---|
| … | … |

---

*Documentos relacionados: [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [TESTING.md](TESTING.md)*
