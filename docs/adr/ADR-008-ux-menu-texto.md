# ADR-008 — UX por menu de texto numerado; botões/listas/enquetes banidos

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** RF-08, RF-25, PRD.md §1 (não-objetivos)

## Contexto

O WhatsApp oferece componentes interativos nativos — botões, listas e enquetes (`sendPoll`) — que em tese dariam uma UX mais polida para menus como "1 feito / 2 reagendar / 3 dropar". Mas no Baileys (a implementação não-oficial usada pela Evolution API), esses componentes estão historicamente instáveis: issues #2390 e #2404 documentam botões e listas quebrados, com comportamento inconsistente entre versões e dispositivos.

Depender de um componente instável no caminho de fechamento de loop — justamente o RF que o PRD chama de "a maior lacuna do mercado" — trocaria confiabilidade por polimento visual, na direção errada da prioridade do produto.

## Decisão

A UX inteira do Norte usa **menu de texto numerado** (`1 feito / 2 reagendar / 3 dropar`, por exemplo) em qualquer ponto que precise de resposta de múltipla escolha. Botões, listas interativas e enquetes (`sendPoll`) do WhatsApp são **banidos do design** — não é uma limitação temporária a remover quando o Baileys estabilizar, é uma decisão de design registrada no PRD como não-objetivo explícito.

O executor determinístico (RF-07) resolve respostas numéricas por código + Haiku, sem exigir que o usuário toque em nada além de digitar um número.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Botões/listas nativas do WhatsApp | Visualmente mais polido, menos digitação para o usuário | Quebrados no Baileys (#2390, #2404); comportamento inconsistente é inaceitável no fechamento de loop, que é o núcleo de valor do produto | Troca confiabilidade por estética, na prioridade errada |
| Detectar suporte a botões e usar quando disponível, cair para texto quando não | Melhor dos dois mundos, em teoria | Mais um caminho de código para manter e testar; "quando disponível" depende de comportamento instável e não documentado do Baileys — complexidade sem garantia de retorno | A instabilidade não é previsível o suficiente para justificar o código condicional |
| Menu de texto numerado em toda a UX, sem exceção | Previsível, testável, funciona em qualquer cliente WhatsApp e em qualquer versão do Baileys; abre caminho natural para o adapter Telegram (RF-28), que também aceita texto | Menos "bonito" que botões nativos; exige o usuário digitar um caractere em vez de tocar | — (escolhida) |

## Consequências

- Positivas: zero dependência de um componente historicamente instável no fluxo mais crítico de valor (fechamento de loop); a mesma UX funciona sem adaptação no canal de contingência Telegram (RF-28), porque texto numerado é universal; comportamento 100% testável e determinístico no CI (sem depender de como um cliente WhatsApp específico renderiza um botão).
- Negativas: a experiência é objetivamente menos polida que apps com UI nativa — decisão consciente de trocar estética por robustez; usuário precisa digitar (baixo atrito, mas não zero) em vez de tocar um botão.
- Reversibilidade: alta — se o Baileys estabilizar botões de forma confiável no futuro, a decisão pode ser revisitada com uma nova ADR; até lá, nenhum código do produto assume a existência de componentes interativos, então não há débito estrutural para desfazer.
