export const meta = {
  name: 'implement-feature',
  description: 'Implementa a spec e itera implementa→testa→corrige até a suite ficar verde, escalando só quando falta decisão humana',
  whenToUse: 'Etapa de implementação do fluxo /feature. Recebe args.spec (caminho da spec em docs/features/) e args.areas (["backend"], ["frontend"] ou ambas). Implementadores e QA em contextos limpos; falha de suite volta ao implementador da área com teto de voltas (args.maxVoltas, padrão 3). Devolve relatório de entrega ou pedido de escalada — nunca para no meio para pedir permissão.',
  phases: [
    { title: 'Implementar', detail: 'backend-dev/frontend-dev a partir da spec' },
    { title: 'Testar', detail: 'qa-engineer cobre o plano de testes e roda a suite completa' },
    { title: 'Corrigir', detail: 'falhas voltam ao implementador da área; teto de voltas' },
  ],
}

const spec = (args && args.spec) || null
if (!spec) return { erro: 'args.spec obrigatório: caminho da spec em docs/features/' }
const areas = (args && args.areas && args.areas.length) ? args.areas : ['backend']
const MAX_VOLTAS = (args && args.maxVoltas) || 3

const ENTREGA_SCHEMA = {
  type: 'object',
  properties: {
    arquivosTocados: { type: 'array', items: { type: 'string' } },
    migracoes: { type: 'array', items: { type: 'string' } },
    desvios: { type: 'string', description: 'desvios da spec com justificativa, ou vazio' },
    precisaDecisao: { type: 'string', description: 'vazio, ou a decisão de produto/arquitetura que impede continuar' },
  },
  required: ['arquivosTocados', 'desvios', 'precisaDecisao'],
}

const SUITE_SCHEMA = {
  type: 'object',
  properties: {
    verde: { type: 'boolean' },
    testesAdicionados: { type: 'array', items: { type: 'string' } },
    falhas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          teste: { type: 'string' },
          resumo: { type: 'string', description: 'o que falha e a causa provável' },
          area: { type: 'string', enum: ['backend', 'frontend', 'teste'] },
        },
        required: ['teste', 'resumo', 'area'],
      },
    },
    precisaDecisao: { type: 'string', description: 'vazio, ou a decisão humana que trava a convergência (ex.: teste que contradiz a spec)' },
  },
  required: ['verde', 'falhas', 'precisaDecisao'],
}

const agenteDaArea = a => (a === 'frontend' ? 'frontend-dev' : (a === 'teste' ? 'qa-engineer' : 'backend-dev'))

// Implementadores em paralelo: pressupõe áreas disjuntas (backend vs frontend).
// Spec que cruza as duas áreas nos mesmos arquivos → rode com uma área só.
phase('Implementar')
const impl = await parallel(areas.map(a => () =>
  agent(
    'Leia a spec ' + spec + ' e implemente a parte de ' + a + ' dela, seguindo suas instruções de agente e os ponteiros ' +
    'da spec para docs/ARCHITECTURE.md e docs/SECURITY.md. Não rode git commit — o versionamento é feito depois, pelo orquestrador. ' +
    'Se travar em decisão de produto ou arquitetura que a spec não resolve, PARE e reporte em precisaDecisao em vez de decidir sozinho.',
    { agentType: agenteDaArea(a), label: 'implementar:' + a, phase: 'Implementar', schema: ENTREGA_SCHEMA }
  )
))

const entregas = impl.filter(Boolean)
const travas = entregas.filter(e => e.precisaDecisao).map(e => e.precisaDecisao)
if (travas.length) {
  log('Implementação travada em decisão humana — escalando sem rodar testes')
  return { verde: false, voltas: 0, entrega: entregas, escalada: travas }
}

phase('Testar')
const rodarSuite = extra =>
  agent(
    'Projeto: spec ' + spec + '. ' + extra + ' Rode a suíte COMPLETA do projeto (comandos em docs/TESTING.md ou nos scripts ' +
    'do repositório) e reporte o resultado. Classifique cada falha por área provável da causa (backend | frontend | teste). ' +
    'Falha cuja causa é teste mal escrito: area = "teste". Não enfraqueça nem apague teste para passar — teste que contradiz ' +
    'a spec vai em precisaDecisao. Não rode git commit.',
    { agentType: 'qa-engineer', label: 'testar:suite', phase: 'Testar', schema: SUITE_SCHEMA }
  )

let suite = await rodarSuite(
  'Antes de rodar, leia o plano de testes da spec e complete os testes que faltam (unit, integração e o que o plano exigir), conforme docs/TESTING.md.'
)

let voltas = 0
while (suite && !suite.verde && !suite.precisaDecisao && voltas < MAX_VOLTAS) {
  voltas++
  log('Suite vermelha — volta ' + voltas + ' de ' + MAX_VOLTAS + ' (' + suite.falhas.length + ' falha(s))')
  const porArea = {}
  for (const f of suite.falhas) (porArea[f.area] = porArea[f.area] || []).push(f)
  await parallel(Object.keys(porArea).map(a => () =>
    agent(
      'A suíte do projeto está vermelha após a implementação da spec ' + spec + '. Corrija a CAUSA das falhas abaixo, na sua área. ' +
      'Proibido enfraquecer ou apagar teste para passar — se um teste contradiz a spec, não mexa nele: reporte em precisaDecisao. ' +
      'Não rode git commit.\n\n' + JSON.stringify(porArea[a], null, 2),
      { agentType: agenteDaArea(a), label: 'corrigir:' + a, phase: 'Corrigir', schema: ENTREGA_SCHEMA }
    )
  ))
  suite = await rodarSuite('Correções da volta ' + voltas + ' aplicadas.')
}

const escalada = []
if (!suite) escalada.push('resultado da suite indisponível — rode a suite manualmente antes de seguir')
else if (suite.precisaDecisao) escalada.push(suite.precisaDecisao)
else if (!suite.verde) escalada.push('suite ainda vermelha após ' + MAX_VOLTAS + ' volta(s) de correção — não insistir sem revisar a abordagem')

// Quem consome: verde e sem escalada → seguir direto para o review (workflow review-feature);
// escalada não vazia → parar e levar a decisão ao dono do projeto.
return { verde: !!(suite && suite.verde), voltas: voltas, entrega: entregas, suite: suite, escalada: escalada }
