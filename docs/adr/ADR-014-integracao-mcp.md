# ADR-014 — Integração com agentes de código via MCP

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ARCHITECTURE.md §2 e §5, ADR-011, PRD RF-30

## Contexto

Requisito do dono: o Norte precisa ser integrável ao Claude Code e ao Codex — os agentes de código que ele usa no dia a dia devem poder operar o assistente (registrar tarefa ao terminar um trabalho, consultar prioridades, criar lembrete) sem passar pelo WhatsApp.

Ambos suportam o **Model Context Protocol (MCP)** como mecanismo padrão de integração com ferramentas externas. A arquitetura do Norte já concentra toda a superfície de escrita em tools declaradas nos manifestos dos módulos (ADR-011), validadas com zod no backend — exatamente o formato que um servidor MCP expõe.

## Decisão

1. As tools dos módulos são declaradas **uma única vez** no `ModuleManifest` e servidas por **dois transportes**: o tool use interno do brain (Claude API) e um **servidor MCP** (`core/mcp`) que expõe o mesmo registry para clientes externos (Claude Code, Codex e qualquer cliente MCP).
2. O servidor MCP é um adapter fino sobre o kernel: **nenhuma lógica própria** — a validação zod, os limites de negócio e a deleção lógica do task-store continuam sendo a única porta de escrita, idêntica para brain e MCP.
3. Transporte e segurança por perfil (ADR-013): no perfil `local`, MCP via stdio/porta em localhost; no perfil `producao`, atrás do Caddy com autenticação por token dedicado (`MCP_AUTH_TOKEN`), nunca exposto sem auth. Toda chamada MCP é registrada (auditoria com origem `mcp`).
4. O servidor MCP em si entra no **M2** (só é útil com o task-store completo), mas o registry de tools do kernel nasce **transport-agnostic desde a FEAT-001** — essa é a restrição de design que esta ADR impõe à fundação.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| API REST própria + plugins/skills por agente | Controle total do formato | Uma integração por agente (Claude Code, Codex, próximos...); manutenção multiplicada | MCP resolve N agentes com 1 servidor |
| MCP como segundo transporte do registry de tools | Declara uma vez, serve todos; validação única no backend; encaixe natural no manifesto | Dependência da especificação MCP (ainda em evolução) | — (escolhida) |
| CLI própria chamada pelos agentes via shell | Simples de começar | Sem schema/descoberta de tools; parsing frágil; sem auth decente no modo remoto | Pior contrato justamente para consumidores-máquina |

## Consequências

- Positivas: Claude Code e Codex operam o Norte com descoberta automática de tools e schemas; módulo novo ganha exposição MCP de graça ao declarar tools no manifesto; a superfície de escrita continua uma só.
- Negativas: versionamento da spec MCP vira dependência a acompanhar; o token MCP é mais um secret com rotação a cuidar (SECURITY.md §4); tools pensadas só para o brain podem precisar de descrições melhores para consumidores externos (nome/descrição fazem parte do contrato público).
- Reversibilidade: alta — o adapter MCP é descartável sem tocar nos módulos; o inverso (amarrar módulos a um protocolo específico) é que seria caro, e esta ADR existe para impedir isso.
