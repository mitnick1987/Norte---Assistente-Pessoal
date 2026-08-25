# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

<!-- Toda entrega adiciona bullets em [Não lançado], sob "Adicionado", "Alterado", "Corrigido", "Removido" ou "Segurança". A skill /release fecha a seção em uma versão SemVer com data. -->

## [Não lançado]

### Adicionado
- Fundação documental do Norte: PRD, arquitetura modular, segurança, testes, ADRs 001–012 e instanciação do template de processo.
- Fluxo `/refactor` (`REF-NNN`): refactor estrutural com testes de caracterização antes de mexer, passos pequenos e comportamento preservado; review pelo mesmo workflow `review-feature`. Inclui template de issue `refactor`.
- `.github/dependabot.yml`: atualização automatizada de dependências (GitHub Actions + npm da raiz, agrupamento minor/patch, major exige review humano), cumprindo a política do SECURITY.md §6.
- Procedimento de rollback no pós-release (`/release` §5): smoke falhou → re-deploy da tag anterior + reversão de migração + incidente registrado como BUG.
- Workflow `implement-feature`: loop autônomo implementa→testa→corrige com teto de voltas e escalada apenas por decisão humana; usado pelo `/feature` §4.
- Processo: política de autonomia e pontos de parada (DEVELOPMENT_PROCESS.md §8) — o fluxo não pede permissão entre etapas; aprovação de spec só bloqueia quando há pergunta de produto/escopo em aberto.
- Proporcionalidade (DEVELOPMENT_PROCESS.md §1.1): via rápida para mudança sem efeito em produção (docs, copy, bumps) e aprovação de spec bloqueante quando o impacto é alto (ADR, área sensível, escopo grande).
- Produção realimenta o backlog: alerta disparado ou erro recorrente vira issue `BUG-NNN` (processo §1 e agente devops-engineer).
- Gate humano de merge: PR com seção "Onde olhar primeiro" e reporte de entrega com "onde olhar em 5 minutos".

### Alterado
- Processo: seção "Sessões longas e contexto dos agentes" no DEVELOPMENT_PROCESS.md (§7) — re-âncora da spec/Definition of Done antes de fechar, leitura de arquivos por trecho, quebra de tarefas longas e delegação por ponteiros; regra replicada nas skills de fluxo e nos agentes implementadores.
