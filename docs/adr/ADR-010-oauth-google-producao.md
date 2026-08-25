# ADR-010 — OAuth Google como app External "In Production", escopos mínimos

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** RF-12, PRD.md §9 (riscos)

## Contexto

O Google Calendar alimenta o briefing matinal e as cadeias de lembrete desde o M1 (RF-12) — é a fonte da agenda real do usuário. A integração usa OAuth 2.0, e o Google distingue apps em modo "Testing" de apps "In Production": apps em Testing têm refresh token com validade de **7 dias**, pensada para desenvolvimento, não para uso contínuo.

Como o Norte é um sistema pessoal do próprio dono (não um produto publicado para terceiros), a tentação natural seria deixar o app em modo Testing — afinal não há usuários externos para revisar ou aprovar. Mas isso significaria o token de acesso ao Calendar expirando a cada 7 dias, silenciosamente, e o briefing perdendo a agenda real sem nenhum aviso até alguém notar a ausência.

## Decisão

O app OAuth do Google é publicado como **External, em status "In Production"**, mesmo sendo de uso pessoal e single-user — porque é esse status que dá ao refresh token validade longa (sem expiração automática por tempo). Escopo solicitado é o mínimo necessário: `calendar.events` no M1 (RF-12); `gmail.readonly` entra só no M2 quando o RF-22 for implementado.

O refresh token é armazenado cifrado em repouso (`auth_tokens.refresh_token`, ver SECURITY.md). Falha de refresh do token — por revogação, expiração inesperada ou erro de rede — dispara alerta por e-mail (RF-13); nunca falha em silêncio.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| App em modo Testing (mais simples de configurar) | Sem processo de publicação, configuração inicial mais rápida | Refresh token expira em 7 dias — a integração quebraria semanalmente sem aviso, exatamente o tipo de falha silenciosa que o PRD proíbe | Inviável para uso contínuo; contradiz o RNF de observabilidade |
| App Internal (G Suite) | Sem necessidade de revisão do Google para escopos sensíveis | Exige conta Google Workspace; o dono usa conta pessoal Gmail comum | Não se aplica ao tipo de conta do usuário |
| App External, "In Production", escopos mínimos | Refresh token de longa duração; escopo mínimo reduz superfície de dado exposto e simplifica eventual revisão do Google | Processo de publicação inicial (ainda que simples para escopos não-sensíveis) | — (escolhida) |

## Consequências

- Positivas: a integração com o Calendar não quebra sozinha a cada semana; escopo mínimo (`calendar.events`, depois `gmail.readonly`) limita o dano de um eventual vazamento do token a exatamente o necessário; falha de refresh vira alerta acionável, não silêncio de agenda.
- Negativas: publicar como "In Production" para um app de escopos sensíveis pode, dependendo do escopo, exigir passos de verificação do Google no futuro (não se aplica aos escopos atuais, mas é um risco a reavaliar se o produto pedir escopos mais amplos); o token cifrado em repouso exige que a chave de cifragem também esteja bem protegida — outra dependência de segurança a manter (ver SECURITY.md).
- Reversibilidade: alta — mudar de escopo ou reconfigurar o app OAuth não afeta dado já persistido; o watchdog de falha de refresh já está desenhado para o caso de token invalidado, então revogar e reautenticar é um caminho testado, não excepcional.
