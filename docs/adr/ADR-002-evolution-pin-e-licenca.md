# ADR-002 — Evolution API: pin na última estável (2.3.7) e postura sobre a licença da 2.4.0+

**Status:** aceita · **Data:** 2026-08-25 (corrigida no mesmo dia) · **Relacionada a:** PRD.md §9 (riscos), ARCHITECTURE.md §1, ADR-008

## Contexto

O Norte usa a Evolution API como adapter para o WhatsApp não-oficial (Baileys). Fatos verificados na documentação oficial (docs.evolutionfoundation.com.br/licensing) e no repositório:

- A partir da **2.4.0**, a Evolution exige **ativação de licença antes de servir tráfego**. A licença do tier `community` é **gratuita**, sem limite de instâncias ou mensagens, e não existem features pagas no produto open source. A ativação envolve cadastro (e-mail, telefone) e telemetria periódica de metadados (versão, UUID da instância, métricas agregadas de uso — nunca conteúdo das comunicações).
- O código segue **Apache 2.0**: forks que removem a ativação são permitidos pela licença do código; o que se perde é o direito à **marca** (nome "Evolution", logo, identidade visual), protegida separadamente. Ou seja, existe uma saída legal de última instância que não depende da Evolution Foundation.
- A **2.4.0 ainda não tem release estável** — apenas release candidates (rc1 e rc2, maio/2026). A última estável é a **2.3.7** (dez/2024).
- Os bugs de botões/listas interativas na 2.3.7 (issues #2390, #2404) não afetam o Norte: a UX baniu esses componentes por decisão de design (ADR-008).

Uma versão anterior desta ADR tratava a licença da 2.4.0+ como bloqueio ("breaking para headless") e por isso pinava a 2.3.6. Premissa corrigida: o custo é zero; o que a 2.4.0+ adiciona de fato é (1) uma dependência de runtime do servidor de licenças da Evolution Foundation no boot/ativação e (2) envio de metadados de telemetria — considerações reais para um produto cujo caminho crítico são lembretes e cuja política de privacidade é "dados no VPS próprio", mas não impeditivos.

Sistema single-user rodando 24/7 sem time de operação: atualização que quebra em produção significa lembretes perdidos, o pecado capital do produto (PRD §1).

## Decisão

1. Pinar a imagem da Evolution API na **última estável, `2.3.7`**, no `infra/docker-compose.yml`. Ficar em versão mais antiga que a estável corrente não tem justificativa (o bug que motivava a 2.3.6 não nos afeta), e correções de protocolo do Baileys são exatamente o que protege contra o maior risco operacional do canal.
2. **Adotar a 2.4.x quando (e só quando) sair estável**, após o processo de upgrade abaixo, incluindo dois testes específicos da licença: comportamento da instância quando o servidor de licenças está indisponível no boot e após a ativação (a sessão continua servindo?); e registro da telemetria como transferência de metadados no SECURITY.md (LGPD).
3. Todo upgrade segue o processo: subir a versão nova em paralelo, rodar a suite de integração e o teste de contingência do canal, validar webhooks, envio de texto/áudio/foto e watchdog de `CONNECTION_UPDATE`, só então trocar a produção.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Seguir `latest` | Correções mais recentes automaticamente | Quebra silenciosa em qualquer redeploy; rc de 2.4.0 poderia entrar sem aviso | Inaceitável para o caminho crítico de lembretes |
| Pin em 2.3.6 (decisão original) | Evita bugs de botões da 2.3.7 | Botões já são banidos pela ADR-008 — o pin abre mão das correções da 2.3.7 sem ganhar nada | Premissa da licença estava errada e o bug evitado não nos atinge |
| Pin em 2.3.7 + migração planejada para 2.4.x estável | Estável mais recente; upgrade é decisão consciente com teste | Exige disciplina de revisitar a versão; 2.4.x adiciona dependência do servidor de licenças e telemetria a avaliar | — (escolhida) |
| Fork da Evolution sem a ativação (permitido pela Apache 2.0, renomeado e sem a marca) | Elimina servidor de licenças e telemetria; para uso pessoal, perder a marca é irrelevante | Manter fork próprio é débito permanente (rebase a cada release upstream) — mais caro que uma ativação gratuita | Não compensa para single-user; fica registrado como saída legal de última instância se a política endurecer |
| Migrar já para outro backend (WAHA, Baileys direto) | Independência da política de licença da Evolution | Reescrever o adapter sem necessidade — a licença é gratuita | Prematuro; segue como plano de contingência (RF-28, adapter) |

## Consequências

- Positivas: nenhuma atualização inesperada derruba a sessão; o produto acompanha a estável corrente sem carregar bugs já corrigidos; a decisão sobre a 2.4.x fica registrada com critérios objetivos em vez de medo de cobrança que não existe.
- Negativas: pin exige disciplina de revisita periódica (checklist em "Operação contínua", PRD §8); quando a 2.4.x estável chegar, o upgrade traz cadastro obrigatório, telemetria de metadados e dependência do servidor de licenças — cada um precisa ser validado e documentado antes da troca; vulnerabilidade conhecida na 2.3.7 tornaria o upgrade urgente com processo comprimido.
- Reversibilidade: alta no papel (uma linha no compose), mas o custo real é a validação. Se a política de licenciamento da Evolution endurecer no futuro, o adapter isola a troca por WAHA, Baileys direto ou Telegram (ARCHITECTURE.md §1, RF-28).
