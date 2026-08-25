# ADR-005 — Número secundário dedicado + política anti-banimento

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** PRD.md §9 (riscos), RF-13

## Contexto

O canal primário do Norte é WhatsApp via Evolution API, que usa Baileys — uma implementação não-oficial do protocolo do WhatsApp, sem suporte da Meta. O risco de banimento de contas ligadas a APIs não-oficiais subiu visivelmente em 2025/26. Se o número banido fosse o número pessoal do dono, o custo do risco seria alto demais para o produto valer a pena; e se os dados do sistema (tarefas, lembretes, histórico) vivessem dentro do próprio WhatsApp, um banimento significaria perda de dados, não só de canal.

A v1 explicitamente não usa a WhatsApp Cloud API oficial (custo por conversa, janela de 24h, necessidade de templates aprovados) — ver não-objetivos do PRD §1. A aposta consciente é Evolution/Baileys com mitigações agressivas, migração para canal oficial ou Telegram documentada como plano B.

## Decisão

O Norte roda num **número secundário dedicado**, pré-pago, aquecido antes de entrar em produção — nunca o número principal do dono. A política anti-banimento é hard-coded no `core/outbox/`, não uma sugestão de operação:

- Volume inicial abaixo de 50 mensagens/dia.
- Delay aleatório de 10–45s antes de cada envio, com `sendPresence` ("composing") simulando digitação.
- Conteúdo variado (o Sonnet varia formulação de briefings, confirmações e cobranças — nunca o mesmo texto literal).
- Teto diário de mensagens proativas (~6/dia, RF-13) somado ao volume de reação, mantendo a conta claramente abaixo de qualquer heurística de spam.

Os dados do sistema (task-store, jobs, facts) vivem 100% no SQLite do brain, nunca no WhatsApp em si — banimento do número vira operação de trocar o chip e reconectar a sessão, não perda de dado.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Número principal do dono | Sem custo de chip extra, sem etapa de aquecimento | Banimento tira o dono do próprio WhatsApp pessoal — custo inaceitável frente ao risco não-oficial | Risco concentrado no ativo errado |
| WhatsApp Cloud API oficial desde a v1 | Zero risco de banimento, suporte oficial da Meta | Custo por conversa, janela de 24h, exige templates pré-aprovados — atrito incompatível com proatividade livre e captura sem estrutura do MVP | Fica como plano B documentado, não decisão da v1 (ver PRD, não-objetivos) |
| Número secundário dedicado e aquecido, com política anti-ban ativa e dados fora do WhatsApp | Isola o risco do número pessoal; recuperação de banimento é rápida (trocar chip); mantém a UX gratuita e livre do MVP | Exige aquecimento antes de produção, disciplina de volume, e ainda carrega risco residual de banimento | — (escolhida) |

## Consequências

- Positivas: banimento deixa de ser incidente catastrófico e vira operação de poucos minutos (novo chip, novo QR, dados intactos); o número pessoal do dono nunca é exposto ao risco da API não-oficial; a política de volume/delay é código, não lembrete manual — não depende de ninguém "lembrar" de ser cauteloso.
- Negativas: aquecimento de número leva tempo antes do lançamento; teto de 50 msgs/dia e delays de 10–45s limitam a capacidade de resposta em rajada (aceitável dado o perfil de uso, mas é uma restrição real); risco de banimento nunca chega a zero — é mitigado, não eliminado; existe custo recorrente pequeno do chip pré-pago (~R$15/mês, PRD §9).
- Reversibilidade: alta para o canal (adapter isola WhatsApp de Telegram, RF-28) e para o número (troca de chip é operação rotineira); baixa para o histórico de "reputação" do número — cada troca reinicia o aquecimento.
