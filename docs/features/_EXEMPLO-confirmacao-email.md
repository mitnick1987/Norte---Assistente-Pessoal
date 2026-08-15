> **Exemplo preenchido** — referência de calibre para specs novas; o modelo em branco é o [_TEMPLATE.md](_TEMPLATE.md). Não conta na numeração de FEATs; apague quando o time não precisar mais dele.

# FEAT-000 — Confirmação de e-mail no cadastro

**Status:** entregue · **Issue:** #12 · **Branch:** `feature/FEAT-000-confirmacao-email` · **Data:** 2026-01-15

## Contexto e objetivo

Hoje qualquer endereço digitado no cadastro vira conta ativa. Isso gera contas com e-mail errado (o usuário perde o acesso na primeira recuperação de senha) e permite cadastro com e-mail de terceiros. Atende o RF-02 do PRD: conta só opera com e-mail verificado.

Depois desta feature, a conta nasce como `pending` e só passa a `active` quando o dono abre o link de confirmação recebido por e-mail.

## Escopo

- Envio de e-mail de confirmação no cadastro, com token de uso único e validade de 24h
- Endpoint de confirmação que ativa a conta e invalida o token
- Reenvio de confirmação, limitado a 3 por hora por conta
- Bloqueio de login de conta `pending`, com mensagem clara e ação de reenvio

## Fora de escopo

- Verificação de e-mail na troca de endereço de conta existente (FEAT futura; reaproveita a infraestrutura de token)
- Confirmação por código numérico (só se o link tiver problema de entregabilidade)

## Decisões tomadas

| Decisão | Alternativas consideradas | Por quê |
|---|---|---|
| Token opaco aleatório, persistido com hash | JWT auto-contido | O token precisa ser revogável no reenvio; JWT válido não se invalida sem lista de bloqueio |
| Validade de 24h | 1h, 7 dias | 1h gera reenvio demais; 7 dias alonga a janela de um link esquecido numa caixa de entrada comprometida |

(Sem impacto duradouro de arquitetura — nenhuma ADR.)

## Impacto técnico

- **Banco:** coluna `status` em `users` (`pending`/`active`); tabela `email_confirmation_tokens` (hash do token, expiração, usado em) — migração reversível
- **API:** `POST /auth/confirm-email` (público, consome o token); `POST /auth/resend-confirmation` (autenticado, com rate limit)
- **Frontend:** tela "confirme seu e-mail" pós-cadastro; página de sucesso/erro do link; aviso no login de conta pendente
- **Permissões:** conta `pending` não acessa nenhuma rota autenticada além do reenvio

## Testes

| Tipo | O que cobre |
|---|---|
| Unit | geração/validação de token: expirado, já usado, hash não confere; regra de rate limit do reenvio |
| Integração | cadastro → e-mail enviado → confirmação ativa a conta; login bloqueado enquanto `pending`; token não aparece em logs nem respostas |
| Segurança/isolamento (se aplicável) | token de um usuário não confirma conta de outro; resposta do reenvio não permite enumerar e-mails cadastrados |
| E2E (se fluxo de negócio) | cadastro completo até o primeiro login com conta ativada |

## Como validar manualmente

1. Cadastre-se com um e-mail de teste; confira que o login não entra e a tela pede confirmação.
2. Abra o link do e-mail (em dev, capturado pelo catcher de e-mail local): a conta ativa e o login funciona.
3. Use o mesmo link de novo: erro de token já utilizado.
4. Peça reenvio 4 vezes seguidas: a quarta é recusada por rate limit.

---

## Entrega (preencher no fim, antes do merge)

- **O que foi feito:** tudo da spec, com um desvio: a validade do token subiu de 24h para 48h após feedback de usuários com e-mail corporativo que só leem no dia seguinte (registrado na issue #12)
- **PRs:** #14
- **Migrações:** `0007_add_user_status`, `0008_create_email_confirmation_tokens`
- **Pendências/débitos:** `TODO(#15)`: métrica de taxa de confirmação em 24h no dashboard
- **Aprendizados:** o provedor de e-mail atrasa até 2 min em horário de pico — o teste E2E espera pelo registro do envio, não pela chegada na caixa de entrada
