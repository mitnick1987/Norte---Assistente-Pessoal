## O que muda

<!-- Resumo objetivo do que este PR faz. Link para a spec: docs/features/FEAT-NNN-*.md (ou REF-NNN-*.md em refactors) -->

## Por quê

<!-- Contexto/motivação, se não estiver óbvio na spec. Refs #issue -->

## Como testar

<!-- Passo a passo para validar manualmente (ou aponte a seção "Como validar" da spec) -->

## Onde olhar primeiro

<!-- Os 2–3 pontos do diff que mais merecem olhar humano: a decisão mais arriscada, o trecho mais sensível, o desvio da spec. Objetivo: 5 minutos de review humano bem gastos. -->

-

## Checklist (Definition of Done)

- [ ] Spec em `docs/features/` com seção **Entrega** preenchida
- [ ] Testes: unit + integração (e suites da área tocada) verdes, cobertura dentro do gate de `docs/TESTING.md`
- [ ] Review `code-reviewer` resolvido (+ `security-auditor` se tocou auth/permissões/dados sensíveis/upload/env)
- [ ] `CHANGELOG.md` atualizado em `[Não lançado]`
- [ ] Migrações reversíveis; TODOs com issue (`TODO(#42)`); sem secret em código
- [ ] Sem secret em código ou em `.env` commitado
- [ ] Validação zod em toda rota/webhook novo
- [ ] Escrita só via task-store / tools strict — nenhuma escrita direta que trate resposta do LLM como registro
- [ ] Deleção sempre lógica (nunca `DELETE` físico)
- [ ] TZ `America/Sao_Paulo` explícita em toda coluna/cálculo de data-hora
- [ ] Se mexeu no system prompt de tom: suite de regressão de tom passou
- [ ] Nenhum comportamento proativo fora da tabela `jobs`
- [ ] Fronteiras de módulo respeitadas (lint boundaries verde)
