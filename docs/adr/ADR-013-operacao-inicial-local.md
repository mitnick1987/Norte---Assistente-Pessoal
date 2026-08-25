# ADR-013 — Operação inicial local; migração para VPS no hardening do M1

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** PRD.md §8 (roadmap), ARCHITECTURE.md §1, ADR-004

## Contexto

A arquitetura foi desenhada para um VPS 24/7 porque lembrete proativo exige o sistema de pé o tempo todo. O dono decidiu, porém, começar rodando tudo **na máquina local** (Windows + Docker Desktop), sem custo de VPS durante a construção do M1 — período em que o sistema ainda não é a fonte de confiança do dia a dia e derrubá-lo para mexer é rotina, não incidente.

O risco aceito é explícito: com a máquina desligada, mensagens proativas não saem na hora. Dois fatores tornam isso tolerável no M1: o scheduler durável já faz catch-up de jobs vencidos no boot (ADR-004) — ligar a máquina dispara o que ficou represado —, e durante a construção o WhatsApp do Norte ainda não é o sistema primário de lembretes do dono.

## Decisão

1. Desenvolvimento e operação inicial rodam **localmente** via Docker Compose (perfil `local`): Evolution API + Postgres/Redis dela + brain. Sem Caddy/TLS (nenhuma porta exposta fora do host; webhook trafega na rede interna do Compose), sem Litestream (backup local por cópia do arquivo SQLite), Healthchecks.io opcional.
2. O `docker-compose.yml` nasce com **dois perfis** (`local` e `producao`) para que a migração seja mudança de perfil, não reescrita: o perfil `producao` acrescenta Caddy, Litestream → B2 e o dead man's switch obrigatório.
3. A migração para o VPS acontece **no hardening do M1 (semana 6)** e é pré-requisito do critério de saída do M1: a "semana de operação com 100% de entrega" que libera o M2 é medida **no VPS**, nunca na máquina local.
4. As metas de confiabilidade do PRD §7 (99,5% de entrega ±2 min, downtime detectado ≤ 5 min) passam a valer integralmente a partir da operação em VPS; antes disso são medidas informativas.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| VPS desde o dia 1 (decisão original) | Ambiente definitivo desde o início; metas valem desde já | Custo e atrito de provisionar antes de existir código; deploy remoto a cada iteração de desenvolvimento | Custo antes da hora; iteração local é mais rápida no M1 |
| Local durante o M1, VPS no hardening | Iteração rápida e grátis; catch-up no boot torna o gap tolerável; migração é troca de perfil do Compose | Lembretes não disparam com a máquina desligada; risco de "esticar" o local para sempre | — (escolhida; o critério de saída do M1 força a migração) |
| Local para sempre | Custo zero permanente | Viola a tese nº 2 do produto (confiabilidade dos lembretes) — inaceitável quando o Norte virar a fonte de confiança | O produto só cumpre a promessa rodando 24/7 |

## Consequências

- Positivas: M1 sem custo de infra; ciclo de desenvolvimento rápido; a estrutura de perfis do Compose documenta desde o início o que é "produção" vs. "dev".
- Negativas: janela do M1 com confiabilidade parcial (aceita); a migração vira etapa obrigatória do hardening — se o VPS atrasar, o M2 atrasa junto (o critério de saída amarra); Windows/Docker Desktop tem particularidades (rede, volumes) que não existirão no VPS Linux — testes de integração no CI (Linux) mitigam surpresas.
- Reversibilidade: total — a decisão é de sequenciamento, não de arquitetura; nada do desenho muda, apenas onde o Compose roda em cada fase.
