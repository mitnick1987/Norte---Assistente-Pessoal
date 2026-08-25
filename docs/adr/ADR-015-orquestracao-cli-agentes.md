# ADR-015 — Orquestração de agentes de código (Claude Code / Codex CLI) por subprocesso, com login delegado aos CLIs

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ADR-014, PRD RF-31, SECURITY.md §4 e §6

## Contexto

Requisito do dono, complementar à ADR-014: além de ser operável pelos agentes (MCP), o Norte precisa **disparar trabalho** no Claude Code e no Codex — do WhatsApp, pedir "roda X no projeto Y" e receber o resultado. Para isso os CLIs precisam estar instalados no host onde o Norte roda (máquina local no M1, VPS depois — ADR-013) e autenticados com as contas do dono.

A questão central é onde vive a credencial da conta. Colocar login de conta Claude/OpenAI dentro do Norte significaria armazenar e renovar credenciais de terceiros no nosso banco — superfície de risco alta e fora do contrato dos fornecedores.

## Decisão

1. **O login fica nos próprios CLIs.** Setup único e manual no host: `claude` (login da conta Claude) e `codex login` (conta OpenAI/ChatGPT). Os CLIs guardam as próprias credenciais nos seus mecanismos nativos; o Norte **nunca armazena nem lê** essas credenciais — apenas verifica disponibilidade ("CLI instalado e autenticado?") para reportar estado no `/health` e no chat.
2. O módulo `integrations/code-agents` (M3) executa os CLIs em **modo headless** (`claude -p ...` / `codex exec ...`) como subprocesso: job durável na tabela `jobs` (execução longa sobrevive a restart como pendência rastreável), timeout, captura de saída e resultado devolvido no chat.
3. **Guardrails inegociáveis** (contrato com SECURITY.md): allowlist de diretórios de trabalho configurada em settings (nenhum caminho fora dela); execução que modifica arquivos exige **confirmação explícita no chat** antes de iniciar (menu 1/2); toda execução auditada (comando, diretório, duração, exit code) — nunca shell arbitrário a partir do WhatsApp.
4. Direção de billing: o trabalho disparado nos CLIs consome as **assinaturas/contas dos próprios CLIs**, não a API key do brain — as duas coisas não se misturam.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Norte guarda credenciais das contas e chama APIs dos agentes | Controle total do fluxo | Armazenar/renovar credenciais de conta de terceiros; fora do desenho de auth dos fornecedores | Risco e manutenção sem benefício — os CLIs já resolvem auth |
| Subprocesso headless dos CLIs autenticados no host | Zero credencial no Norte; CLIs cuidam do próprio auth e atualizações; funciona igual no local e no VPS | Exige setup manual único por host; dependência do formato headless dos CLIs | — (escolhida) |
| Só MCP (ADR-014), sem disparar agentes | Menos superfície | Não atende o requisito — o dono quer delegar trabalho do chat | Complementar, não substituto |

## Consequências

- Positivas: nenhuma credencial de conta no banco do Norte; instalar/logar CLI novo no host é o único setup; agente de código novo com CLI headless entra pelo mesmo módulo.
- Negativas: setup manual por host (documentar no README de operação); formatos headless dos CLIs mudam e precisam de acompanhamento; execução de agente é a operação mais perigosa do produto — os guardrails do item 3 são bloqueantes de review (gatilho do security-auditor).
- Reversibilidade: alta — o módulo é plugável (ADR-011) e removível sem tocar no resto.
