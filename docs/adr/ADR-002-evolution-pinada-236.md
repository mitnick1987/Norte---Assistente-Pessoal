# ADR-002 — Evolution API pinada em 2.3.6

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** PRD.md §9 (riscos), ARCHITECTURE.md §1

## Contexto

O Norte usa a Evolution API como adapter para o WhatsApp não-oficial (Baileys). A versão 2.4.0+ passou a exigir ativação de licença obrigatória (issue #2534 no repositório da Evolution) — mudança breaking para instalação self-hosted headless como a do Norte, que roda sem interface administrativa e sem intervenção manual. Além disso, botões, listas e enquetes interativas do WhatsApp estão quebrados no Baileys nas versões recentes (issues #2390 e #2404), o que já motivou a decisão de design de banir esses componentes da UX (ADR-008).

Sistema single-user rodando 24/7 sem time de operação: uma atualização que quebra em produção significa lembretes perdidos, o pecado capital do produto (PRD §1). Atualizar por atualizar, sem necessidade funcional, é risco que não compensa.

## Decisão

Pinar a imagem da Evolution API em `2.3.6` no `infra/docker-compose.yml`, com upgrade proibido por padrão.

Upgrade só acontece quando houver motivo concreto (bug bloqueante na 2.3.6, funcionalidade nova necessária) e segue processo: subir a versão nova em ambiente paralelo, rodar a suite de testes de integração e o teste de contingência do canal contra ela, validar que webhooks, envio de texto/áudio/foto e watchdog de `CONNECTION_UPDATE` continuam funcionando, só então trocar a produção.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Seguir `latest` / última tag estável | Sempre com correções de bug mais recentes | 2.4.0+ quebra headless self-hosted por exigir ativação de licença; risco de quebra silenciosa em qualquer redeploy | Inaceitável para caminho crítico de lembretes — quebra sem aviso é o pior cenário do produto |
| Pin em 2.3.6 com upgrade só após teste em paralelo | Estabilidade previsível; upgrade é decisão consciente, não acidente de redeploy | Perde correções de bug e melhorias posteriores até decidir migrar; exige disciplina de revisitar a versão periodicamente | — (escolhida) |
| Migrar já para outro backend (WAHA, Baileys direto) | Evita o problema de licenciamento de vez | Reescrever o adapter inteiro sem necessidade imediata; 2.3.6 ainda atende | Prematuro — vira plano de contingência, não decisão do M1 |

## Consequências

- Positivas: nenhuma atualização inesperada derruba a sessão do WhatsApp; superfície de comportamento da Evolution é estável e conhecida durante todo o M1.
- Negativas: pin de versão é débito que exige disciplina — alguém precisa lembrar de revisitar periodicamente (checklist em "Operação contínua" no PRD §8); bugs corrigidos em versões posteriores só chegam depois de teste manual em paralelo; se a 2.3.6 ganhar uma vulnerabilidade de segurança conhecida, o upgrade vira urgente e o teste em paralelo precisa ser comprimido.
- Reversibilidade: alta no papel (trocar uma linha de versão no compose), mas o custo real é o processo de validação antes de trocar — nunca é "só subir a versão nova". Se a Evolution se tornar inviável (licenciamento mais restritivo ainda), o adapter isola a troca por WAHA, Baileys direto ou Telegram (ver ARCHITECTURE.md §1 e RF-28).
