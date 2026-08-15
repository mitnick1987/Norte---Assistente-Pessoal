## O que muda

<!-- Resumo objetivo do que este PR faz. Link para a spec: docs/features/FEAT-NNN-*.md -->

## Por quê

<!-- Contexto/motivação, se não estiver óbvio na spec. Refs #issue -->

## Como testar

<!-- Passo a passo para validar manualmente (ou aponte a seção "Como validar" da spec) -->

## Checklist (Definition of Done)

<!-- ADAPTE: acrescente itens das regras inegociáveis do domínio deste projeto. Exemplos reais de outros projetos: teste de isolamento de dados por cliente em toda tabela nova; invariantes de valores monetários cobertas por teste. -->

- [ ] Spec em `docs/features/` com seção **Entrega** preenchida
- [ ] Testes: unit + integração (e suites da área tocada) verdes, cobertura dentro do gate de `docs/TESTING.md`
- [ ] Review `code-reviewer` resolvido (+ `security-auditor` se tocou auth/permissões/dados sensíveis/upload/env)
- [ ] `CHANGELOG.md` atualizado em `[Não lançado]`
- [ ] Migrações reversíveis; TODOs com issue (`TODO(#42)`); sem secret em código
