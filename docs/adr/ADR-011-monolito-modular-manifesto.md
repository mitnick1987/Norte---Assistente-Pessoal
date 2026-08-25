# ADR-011 — Monolito modular: kernel + módulos com manifesto, fronteiras por lint

**Status:** aceita · **Data:** 2026-08-25 · **Relacionada a:** ARCHITECTURE.md §2, PRD.md §8 (roadmap)

## Contexto

Exigência explícita do dono do projeto: o Norte vai acumular muitas funcionalidades ao longo dos anos — o roadmap do PRD já lista 29 requisitos funcionais entre M1, M2 e M3, e a intenção declarada é que essa lista continue crescendo em "operação contínua" por tempo indefinido. Ao mesmo tempo, o RNF de manutenibilidade exige que o sistema continue mantível por uma pessoa só daqui a dois anos — o que descarta tanto um monolito não-estruturado (vira bola de lama conforme cresce) quanto microserviços (PRD proíbe explicitamente como não-objetivo: excesso de infraestrutura para um produto single-user).

A tensão a resolver: como crescer em número de funcionalidades sem que cada funcionalidade nova aumente o custo de entender e modificar as anteriores.

## Decisão

Arquitetura de **monolito modular**: um único processo Node.js, mas internamente organizado em `core/` (núcleo estável, nunca conhece módulos) e `modules/` (capacidades plugáveis — uma pasta por funcionalidade).

Cada módulo se registra no kernel por um contrato único de extensão, o `ModuleManifest`:

```ts
interface ModuleManifest {
  name: string;
  migrations?: Migration[];
  tools?: ToolDefinition[];
  commands?: CommandMatcher[];
  jobs?: Record<string, JobHandler>;
  events?: Partial<EventHandlers>;
  settingsDefaults?: SettingsMap;
  promptFragment?: () => string;
}
```

Regras de dependência impostas por `eslint-plugin-boundaries` (lint, não disciplina de code review): `core/` nunca importa de `modules/`; um módulo importa só `core/` e o contrato público de `tasks/` (o único módulo "de dados" referenciável por outros, via serviço/tools, nunca SQL direto); módulos se comunicam entre si exclusivamente por eventos no bus interno — desligar um módulo não pode quebrar outro, com `tasks` como única exceção por ser fundação.

Adicionar uma funcionalidade nova é criar uma pasta em `src/modules/`, sem tocar no core nem nos outros módulos.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Monolito sem estrutura modular imposta (organização só por convenção) | Zero overhead inicial, mais rápido para as primeiras features | Sem fronteira imposta por ferramenta, acoplamento entre features cresce silenciosamente; em anos de RFs acumulados vira bola de lama, justamente o risco que o RNF de manutenibilidade quer evitar | Não sobrevive à escala de funcionalidades planejada para o produto |
| Microserviços (um serviço por módulo) | Isolamento forte, deploy independente por funcionalidade | Overhead operacional (N deploys, N containers, comunicação de rede, observabilidade distribuída) para um produto single-user sem necessidade de escalar horizontalmente | Não-objetivo explícito do PRD; complexidade sem benefício real na escala do produto |
| Monolito modular: kernel + `ModuleManifest`, fronteiras por `eslint-plugin-boundaries`, comunicação só por eventos | Cresce em funcionalidades sem acoplamento cruzado; fronteira é imposta por ferramenta (lint falha o build), não depende de disciplina humana; um processo só para operar (deploy, log, backup) | Exige desenhar o contrato do manifesto com cuidado desde o início; disciplina de "tudo por evento" tem custo de indireção mesmo quando dois módulos "poderiam" só chamar função um do outro | — (escolhida) |

## Consequências

- Positivas: adicionar RF novo (M2, M3, ou o que vier depois) é aditivo — nova pasta, novo manifesto, zero edição em módulos existentes; a fronteira arquitetural é verificada automaticamente no CI (lint), não depende de review humano pegar todo acoplamento indevido; qualquer módulo pode ser desligado (exceto `tasks`) sem quebrar o resto, o que também facilita testar módulos isoladamente.
- Negativas: comunicação exclusivamente por eventos adiciona indireção — depurar um fluxo que atravessa dois módulos exige seguir o rastro de eventos no bus, não uma chamada de função direta; o contrato do `ModuleManifest` precisa ser estável desde cedo, porque mudá-lo depois de vários módulos registrados é uma migração que toca todos eles; a regra de fragmentos de prompt em ordem determinística (para não invalidar o cache do ADR-007) é uma restrição extra que todo módulo com `promptFragment` precisa respeitar.
- Reversibilidade: baixa depois de vários módulos implementados — o contrato do manifesto e a regra de eventos-only viram a espinha dorsal de todo o código de domínio; mudar de abordagem depois exigiria retrabalhar todos os módulos existentes, não só o kernel.
