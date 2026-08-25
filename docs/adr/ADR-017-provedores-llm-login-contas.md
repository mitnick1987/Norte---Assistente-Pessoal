# ADR-017 — Provedores de LLM plugáveis com login de contas via UI (estilo OmniRoute)

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ADR-007, ADR-012, ADR-015, ADR-016, PRD RF-33, SECURITY.md §4

## Contexto

Requisito do dono, inspirado no OmniRoute (github.com/diegosouzapw/OmniRoute): pela UI dele é possível **logar com contas Claude/ChatGPT** (mesmo fluxo OAuth dos CLIs oficiais) e usar as assinaturas como provedores de modelo — em vez de (ou além de) API keys. O dono quer essa capacidade dentro do Norte: logar com as contas e usá-las como backend do cérebro.

Distinção em relação às ADRs vizinhas: a ADR-016 torna o Norte **um provedor** (outros apontam para ele); esta ADR trata o Norte como **consumidor** de provedores — quem serve os tokens que o brain consome. A ADR-015 (CLIs delegados, login nos CLIs) segue válida para delegar trabalho de código; aqui o assunto é o LLM interno do Norte.

Risco que precisa ficar registrado: usar OAuth de assinatura fora dos clientes oficiais é **área cinzenta dos termos de uso** da Anthropic e da OpenAI. Ferramentas como OmniRoute e 9router fazem isso abertamente, mas há risco real de suspensão da conta. A decisão abaixo isola esse risco como escolha consciente e reversível do dono, nunca como dependência estrutural.

## Decisão

1. `core/llm` nasce com **abstração de provedor plugável** (contrato: chat com tool use + streaming + usage/custo). Provedores previstos: `anthropic-api-key` (padrão), `claude-account` (OAuth de assinatura), `openai-account` (OAuth de assinatura), extensível a outros.
2. **API key da Anthropic é o caminho padrão e o único suportado para os fluxos críticos em produção** (briefing, triagem, cobranças). Contas logadas entram como provedores alternativos que o dono habilita por função (ex.: conversa livre e consultas via MCP/canal API pela assinatura; caminho crítico continua na API key). O orçamento da ADR-007 permanece calculado 100% em API key — economia de assinatura é bônus, nunca premissa.
3. **Login pela UI local de administração** (M3): fluxo OAuth idêntico ao dos CLIs oficiais, iniciado no dashboard mínimo do Norte — página servida pelo próprio brain, com o design system do MedClinic (ADR-012). A UI mostra contas conectadas, validade dos tokens, provedor ativo por função e uso/custo.
4. Tokens de conta armazenados **cifrados em `auth_tokens`** (AES-256-GCM, mesmo regime dos tokens Google — SECURITY.md §4), com refresh automático e alerta por e-mail em falha. Revogar = apagar a linha (deleção lógica) + revogação no fornecedor quando disponível.
5. Falha ou suspensão de conta **degrada, não derruba**: o roteador de provedores cai para a API key automaticamente e avisa no chat. O risco de ToS fica confinado ao que a conta serve.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Só API key (status quo da ADR-007) | Zero risco de ToS; simples | Ignora as assinaturas que o dono já paga; contraria requisito explícito | O dono decidiu correr o risco conscientemente — cabe à arquitetura isolá-lo |
| Contas como provedores plugáveis com fallback para API key | Aproveita assinaturas; risco isolado por função; reversível | Fluxos OAuth não oficiais a manter; risco de suspensão da conta; superfície de segurança maior (tokens de conta em repouso) | — (escolhida) |
| Rotear tudo pela assinatura | Custo mínimo de API | Caminho crítico do produto refém de área cinzenta de ToS; suspensão da conta = assistente mudo | Viola a tese de confiabilidade (PRD §1) |
| Usar OmniRoute/9router como intermediário em vez de implementar | Pronto, testado | Mais um serviço 24/7 para operar; dados de conversa passando por código de terceiro; dependência estrutural de projeto externo | Preferimos o padrão deles, não a dependência deles; nada impede o dono de plugar o Norte neles via base URL se quiser |

## Consequências

- Positivas: as assinaturas Claude/ChatGPT do dono viram capacidade do Norte; trocar/adicionar provedor é plugável; a UI de administração inaugura o uso do design system (ADR-012) e vira casa natural para status de integrações (CLIs da ADR-015, canal da ADR-016).
- Negativas: manutenção de fluxos OAuth não documentados oficialmente (quebram sem aviso); risco de suspensão de conta documentado e aceito; `auth_tokens` passa a guardar credenciais mais sensíveis — rotação e cifra viram ponto fixo de auditoria (gatilho do security-auditor); UI local é superfície nova (mesmo que só em localhost/Caddy com auth).
- Reversibilidade: alta — desabilitar provedores de conta devolve o sistema ao regime ADR-007 puro sem tocar nos módulos.
