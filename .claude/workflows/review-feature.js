export const meta = {
  name: 'review-feature',
  description: 'Review do diff da branch: reviewers em paralelo + verificação adversarial dos achados',
  whenToUse: 'Etapa de review dos fluxos /feature e /bugfix. Revisa o diff contra a branch principal com o code-reviewer (e o security-auditor quando o diff toca área sensível) e tenta refutar cada achado antes de reportar. Aceita args.base (branch de comparação; padrão: main).',
  phases: [
    { title: 'Mapear', detail: 'entender o diff e decidir se o security-auditor entra' },
    { title: 'Revisar', detail: 'code-reviewer sempre; security-auditor se tocou área sensível', model: 'opus' },
    { title: 'Verificar', detail: 'um cético tenta refutar cada achado', model: 'opus' },
  ],
}

const base = (args && args.base) || 'main'

const ESCOPO_SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'string', description: 'o que o diff muda, em 2-3 frases' },
    tocaAreaSensivel: { type: 'boolean' },
    justificativa: { type: 'string', description: 'quais gatilhos do security-auditor o diff toca, ou por que nenhum' },
  },
  required: ['resumo', 'tocaAreaSensivel', 'justificativa'],
}

const ACHADOS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          titulo: { type: 'string' },
          descricao: { type: 'string', description: 'o defeito e o cenário concreto em que ele se manifesta' },
          severidade: { type: 'string', enum: ['bloqueante', 'importante', 'sugestao'] },
        },
        required: ['file', 'titulo', 'descricao', 'severidade'],
      },
    },
  },
  required: ['findings'],
}

const VEREDITO_SCHEMA = {
  type: 'object',
  properties: {
    procede: { type: 'boolean' },
    justificativa: { type: 'string' },
  },
  required: ['procede', 'justificativa'],
}

phase('Mapear')
let escopo = await agent(
  'Rode "git diff ' + base + '...HEAD --stat" e depois "git diff ' + base + '...HEAD" para entender o que a branch muda. ' +
  'Leia .claude/agents/security-auditor.md — os gatilhos listados lá (incluindo os que o projeto acrescentou) são a fonte da verdade — ' +
  'e responda se o diff toca alguma área sensível que exige o security-auditor.',
  { label: 'mapear:diff', phase: 'Mapear', schema: ESCOPO_SCHEMA }
)
// Sem mapeamento, errar para o lado de auditar.
if (!escopo) escopo = { resumo: '', tocaAreaSensivel: true, justificativa: 'mapeamento indisponível; auditoria incluída por precaução' }

const dimensoes = [{
  tipo: 'code-reviewer',
  prompt: 'Revise o diff completo da branch ("git diff ' + base + '...HEAD"): correção, qualidade, aderência a docs/ARCHITECTURE.md e docs/process/CODE_STYLE.md. ' +
    (escopo.resumo ? 'Contexto: ' + escopo.resumo + ' ' : '') +
    'Para cada achado, informe arquivo, linha, severidade (bloqueante | importante | sugestao) e o cenário concreto em que o problema se manifesta.',
}]
if (escopo.tocaAreaSensivel) {
  dimensoes.push({
    tipo: 'security-auditor',
    prompt: 'Audite o diff da branch ("git diff ' + base + '...HEAD") conforme seu checklist. Motivo da auditoria: ' + escopo.justificativa + '. ' +
      'Para cada achado, informe arquivo, linha, severidade (bloqueante | importante | sugestao) e o cenário concreto de falha ou exploração.',
  })
} else {
  log('Diff não toca área sensível — security-auditor dispensado (' + escopo.justificativa + ')')
}

// pipeline sem barreira: os achados de um reviewer entram em verificação enquanto o outro
// ainda revisa. model 'opus' explícito nos dois estágios — o processo proíbe review (e o
// julgamento dos achados) em modelo menor (DEVELOPMENT_PROCESS.md §6).
const resultados = await pipeline(
  dimensoes,
  d => agent(d.prompt, { agentType: d.tipo, model: 'opus', label: 'revisar:' + d.tipo, phase: 'Revisar', schema: ACHADOS_SCHEMA }),
  (review, d) => parallel((review.findings || []).map(a => () =>
    agent(
      'Tente REFUTAR o achado de review abaixo lendo o código do repositório. Só refute com evidência concreta: ' +
      'o cenário descrito não acontece, o caso já é tratado, ou o comportamento é intencional e documentado. ' +
      'Evidência inconclusiva = o achado procede.\n\n' + JSON.stringify(a, null, 2),
      { model: 'opus', label: 'verificar:' + a.file, phase: 'Verificar', schema: VEREDITO_SCHEMA }
    ).then(v => ({ origem: d.tipo, ...a, procede: v ? v.procede : true, veredito: v ? v.justificativa : 'verificador indisponível; achado mantido' }))
  ))
)

const peso = { bloqueante: 0, importante: 1, sugestao: 2 }
const verificados = resultados.filter(Boolean).flat().filter(Boolean)
const confirmados = verificados.filter(a => a.procede).sort((x, y) => peso[x.severidade] - peso[y.severidade])
const refutados = verificados.filter(a => !a.procede)

log(confirmados.length + ' achado(s) confirmado(s), ' + refutados.length + ' refutado(s) na verificação')

// Quem consome o resultado: corrigir bloqueantes e importantes antes do merge; sugestões viram issues.
return { escopo, achadosConfirmados: confirmados, achadosRefutados: refutados }
