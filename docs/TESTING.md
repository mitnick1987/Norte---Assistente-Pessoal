# Estratégia de Testes — {{PROJETO}}

**Versão:** 1.0 · **Data:** {{DATA}} · Referências: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md)

Pirâmide: **muitos unitários, integração nas rotas críticas, E2E nos fluxos de negócio**. Nenhum PR mergeia com suite vermelha.

Ferramentas de teste: as definidas em [ARCHITECTURE.md](ARCHITECTURE.md) para a stack do projeto.
<!-- ADAPTE: fixe aqui as ferramentas concretas de cada camada. Exemplos reais de outros projetos: Vitest (unit/integração), Testcontainers (dependências reais em container), supertest (rotas HTTP), Playwright (E2E e regressão visual), k6 (carga), axe-core (acessibilidade). -->

---

## 1. Unitários

Alvo: lógica pura. Rápidos (< 30 s a suite), sem rede/banco.

- Todo módulo de domínio crítico tem **gate de cobertura no CI** (padrão: **≥ 80%**).
- Código que valida/interpreta entrada externa: **100% dos caminhos de erro** cobertos.
- Guards de autorização: a matriz papel × permissão do [SECURITY.md](SECURITY.md) vira teste parametrizado — 100% da matriz.
- **Golden tests:** casos reais aprovados pela área de negócio viram fixtures; regressão neles bloqueia merge.
- Contratos de entrada/saída: round-trip serialize/parse dos DTOs críticos.

<!-- ADAPTE: liste aqui os módulos críticos deste projeto com casos obrigatórios e gate de cobertura, em tabela | Área | Casos obrigatórios | Cobertura |. Exemplos reais de outros projetos: motor de cálculo com testes de fronteira exata de faixas e de arredondamento; parser próprio com whitelist de operadores e profundidade máxima (sem DoS por expressão), 100% dos caminhos de erro. -->

## 2. Integração

Sobem as **dependências reais (banco, cache, fila)** em container por suite; migrações aplicadas do zero (valida as migrações a cada CI).

- Rotas críticas da API testadas contra o processo real: auth completo (login/refresh/rotação/reuso de refresh) e os fluxos centrais de negócio.
- **Servidor não confia no cliente:** valores derivados/calculados enviados pelo cliente são ignorados e recomputados no servidor (teste explícito).
- **Idempotência:** replay de POST mutável com a mesma `Idempotency-Key` não duplica efeito.
- Workers/jobs assíncronos: caminho feliz + retry.

<!-- ADAPTE: liste aqui as rotas e os jobs deste projeto que exigem teste de integração obrigatório. -->

## 3. Suite de segurança/isolamento — obrigatória

Bloqueia merge. Cada cenário roda com conexões reais e o **mesmo mecanismo de contexto de segurança usado em produção** — nada de mockar o enforcement.

Cenários mínimos, válidos para qualquer projeto:

| # | Cenário | Esperado |
|---|---|---|
| S1 | Usuário lê recurso de outra conta/escopo | 0 linhas / 404 |
| S2 | Papel sem permissão chama rota restrita | 403 |
| S3 | Ação acima de um limite de negócio enviada direto à API | rejeitada no backend (422) |
| S4 | Anônimo acessa recurso não publicado | 404 |
| S5 | UPDATE/DELETE em trilha de auditoria com a role da aplicação | erro de permissão |
| S6 | Requisição sem contexto de segurança definido | 0 linhas (fail-closed) |

<!-- ADAPTE: expanda a suite com os cenários específicos deste projeto e numere-os (S1..Sn) — a numeração é referenciada no CI e nos specs de feature. Exemplos reais de outros projetos: isolamento entre contas testado em toda tabela com dado de cliente; token de compartilhamento alheio, inválido ou expirado → 404; acesso cross-conta de staff permitido E registrado na trilha de auditoria. -->

## 4. E2E

Contra ambiente efêmero com seed determinístico. Desktop + viewport mobile.

- Cada persona do [PRD.md](PRD.md) tem ao menos um fluxo feliz completo coberto.
- Limites de negócio testados dos dois lados: bloqueio na UI **e**, chamando a API direto, bloqueio no backend.
- Fluxos que geram artefatos (documento, arquivo, e-mail) verificam o artefato final, não só o status da resposta.
- Sessão que expira no meio de um fluxo renova sem perder o estado do usuário.

<!-- ADAPTE: liste aqui, numerados, os fluxos de negócio ponta-a-ponta deste projeto — um por persona/jornada crítica do PRD. -->

## 5. Não-funcionais

- **Carga:** endpoints públicos e de escrita crítica com metas explícitas de latência (p95) e verificação de rate limit (429 correto sob abuso). <!-- ADAPTE: defina as metas deste projeto. Exemplo real de outro projeto: p95 < 100 ms no endpoint mais quente com 100 VUs. -->
- **Acessibilidade:** páginas públicas com gate automatizado — sem violações `serious+`.
- **Visual:** regressão de screenshot nas telas em que a aparência é requisito de negócio.

## 6. CI/CD — gates

```
PR → lint + typecheck + boundaries
   → unit (gates de cobertura dos módulos críticos)
   → security scans (SAST, secrets, dependências, imagens)
   → integração + suite de segurança/isolamento (S1..Sn)
   → build
merge → E2E em ambiente efêmero → deploy staging
tag  → smoke E2E em staging → deploy produção → smoke pós-deploy
```

<!-- ADAPTE: fixe as ferramentas concretas dos scans e a estratégia de deploy. Exemplos reais de outros projetos: Semgrep (SAST), gitleaks (secrets), OSV (dependências), Trivy (imagens); deploy rolling. -->

Flakiness: teste E2E que falhar 2× sem mudança relacionada entra em quarentena com issue aberta — não se apaga teste vermelho.
