# ADR-012 — Qualquer UI futura usa o design system do MedClinic

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** PRD.md §1 (não-objetivos)

## Contexto

A v1 do Norte não tem nenhuma UI própria — a interface é 100% conversacional no WhatsApp, e-mail é usado só para alertas de infraestrutura (não-objetivo explícito do PRD: "App próprio (mobile ou web), dashboard ou qualquer UI fora do chat"). Ainda assim, é plausível que fases futuras (M3 em diante, ou operação contínua) eventualmente peçam alguma superfície visual — um painel de configuração, uma visão de patterns, algo que uma conversa de texto não serve bem.

O dono do projeto mantém outro produto, o MedClinic, que já tem um design system consolidado. A diretriz dele é que qualquer UI futura do Norte não comece do zero: reaproveita esse design system, tanto por consistência visual entre os produtos do dono quanto por não reinventar decisões de UI já validadas.

## Decisão

Se e quando o Norte ganhar qualquer UI (fora do escopo desta v1), ela usa o design system do projeto MedClinic como base obrigatória:

- **Stack:** Next.js + Tailwind CSS v4.
- **Paleta:** zinc dark-first (`zinc-950`/`zinc-900`/`zinc-800` como base) com acento emerald (`emerald-600` em botões primários, `emerald-500` em focus ring).
- **Tema claro:** implementado por remapeamento das variáveis `--color-zinc-*` em `:root:not(.dark)` — não é um tema paralelo, é a mesma paleta semântica invertida.
- **Fontes:** família Geist.
- **Componentes-base:** reaproveitados de `src/components/ui.tsx` do MedClinic — `Card`, `PageHeader`, `StatCard`, `Label`/`Field`, `Badge` (6 tons), `TableCard`, `Avatar`, `EmptyState`.
- **Tokens utilitários:** `inputClass`, `buttonClass`, `buttonSecondaryClass` como as classes Tailwind compostas padrão para inputs e botões.

Esta ADR não cria nenhum trabalho na v1 — ela apenas fixa a decisão para quando (se) o trabalho aparecer, evitando que uma UI futura seja desenhada do zero ou com uma linguagem visual divergente do resto dos produtos do dono.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Desenhar um design system novo e próprio do Norte quando a UI for necessária | Liberdade total para adaptar à identidade específica do produto | Trabalho de design duplicado; inconsistência visual entre os produtos do mesmo dono; adia uma decisão que já tem resposta óbvia | Sem ganho real que justifique o retrabalho |
| Usar um design system de terceiros pronto (ex.: shadcn/ui puro, Material) | Comunidade grande, documentação abundante | Não carrega a identidade visual já estabelecida nos outros produtos do dono; ainda exigiria trabalho de tematização do zero | Não atende à diretriz de consistência entre produtos do dono |
| Reaproveitar o design system do MedClinic (Tailwind v4, paleta zinc+emerald, componentes de `ui.tsx`) | Consistência visual entre produtos do dono; componentes e decisões de UI já validados em produção noutro projeto; zero trabalho de design quando a UI for necessária | Acopla a identidade visual do Norte à evolução do design system do MedClinic — mudanças lá podem pedir revisão aqui | — (escolhida) |

## Consequências

- Positivas: quando (e se) a v1-sem-UI deixar de ser suficiente, não há decisão de design a tomar — só implementação; consistência de marca entre os produtos do mesmo dono; componentes e paleta já testados em produção reduzem risco de retrabalho de UI.
- Negativas: esta é uma decisão tomada sem nenhuma UI real do Norte para validar contra — é possível que necessidades específicas do Norte (por exemplo, visualização de agenda ou timeline de lembretes) peçam componentes que o design system do MedClinic ainda não tem, exigindo extensão dele; acopla a futura UI do Norte a um design system mantido primariamente para outro produto.
- Reversibilidade: alta enquanto nenhuma UI existir — é só uma diretriz registrada; depois de qualquer UI construída sobre essa base, reverter significaria retrabalhar as telas, não só a decisão.
