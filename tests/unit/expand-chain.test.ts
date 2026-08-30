import { describe, expect, it } from 'vitest';
import { expandChain } from '../../src/modules/chains/domain/index.js';
import type { ChainSettings, ChainSourceEvent } from '../../src/modules/chains/domain/index.js';

const DEFAULT_SETTINGS: ChainSettings = { vesperaHour: 20, manhaHour: 8, prepMarginMin: 15 };

function buildEvent(overrides: Partial<ChainSourceEvent> = {}): ChainSourceEvent {
  return {
    eventId: 1,
    itemId: 10,
    title: 'dentista',
    startAt: new Date('2026-08-28T17:00:00.000Z'), // sexta 14h America/Sao_Paulo
    deslocamentoMin: 30,
    ...overrides,
  };
}

describe('expandChain (RF-04, gerador determinístico de cadeia)', () => {
  it('gera véspera, manhã e preparo com os horários de settings aplicados', () => {
    const now = new Date('2026-08-25T13:00:00.000Z'); // terça 10h SP

    const reminders = expandChain(buildEvent(), DEFAULT_SETTINGS, now);

    expect(reminders.map((r) => r.tipoCadeia)).toEqual(['vespera', 'manha', 'preparo']);
    // véspera: quinta (27/08) 20h SP = 23h UTC.
    expect(reminders[0]).toMatchObject({ tipoCadeia: 'vespera', fireAt: new Date('2026-08-27T23:00:00.000Z') });
    // manhã: sexta (28/08) 8h SP = 11h UTC.
    expect(reminders[1]).toMatchObject({ tipoCadeia: 'manha', fireAt: new Date('2026-08-28T11:00:00.000Z') });
  });

  it('desconta deslocamento + margem de preparo no cálculo do alerta de saída', () => {
    const now = new Date('2026-08-25T13:00:00.000Z');

    const reminders = expandChain(buildEvent({ deslocamentoMin: 40 }), { ...DEFAULT_SETTINGS, prepMarginMin: 20 }, now);

    const preparo = reminders.find((r) => r.tipoCadeia === 'preparo');
    // 17:00 UTC - 40min - 20min = 16:00 UTC.
    expect(preparo?.fireAt).toEqual(new Date('2026-08-28T16:00:00.000Z'));
  });

  it('omite véspera e manhã quando o compromisso é hoje à tarde (ambas cairiam no passado)', () => {
    // compromisso hoje (28/08) às 14h SP; now já é hoje de manhã, 9h SP.
    const now = new Date('2026-08-28T12:00:00.000Z');
    const event = buildEvent({ startAt: new Date('2026-08-28T17:00:00.000Z') });

    const reminders = expandChain(event, DEFAULT_SETTINGS, now);

    expect(reminders.map((r) => r.tipoCadeia)).toEqual(['preparo']);
  });

  it('omite só o preparo quando o horário de saída já passou mas o compromisso ainda não aconteceu', () => {
    const startAt = new Date('2026-08-28T17:00:00.000Z');
    const now = new Date('2026-08-28T16:50:00.000Z'); // 10 min antes do compromisso, depois do horário de saída (16h15)

    const reminders = expandChain(buildEvent({ startAt }), DEFAULT_SETTINGS, now);

    expect(reminders.map((r) => r.tipoCadeia)).toEqual([]);
  });

  it('omite a cadeia inteira quando o compromisso já passou por completo', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');

    const reminders = expandChain(buildEvent(), DEFAULT_SETTINGS, now);

    expect(reminders).toHaveLength(0);
  });

  it('antecedências customizadas em settings substituem os defaults', () => {
    const now = new Date('2026-08-25T13:00:00.000Z');
    const customSettings: ChainSettings = { vesperaHour: 22, manhaHour: 6, prepMarginMin: 30 };

    const reminders = expandChain(buildEvent(), customSettings, now);

    const vespera = reminders.find((r) => r.tipoCadeia === 'vespera');
    const manha = reminders.find((r) => r.tipoCadeia === 'manha');
    expect(vespera?.fireAt).toEqual(new Date('2026-08-28T01:00:00.000Z')); // quinta 22h SP = sexta 01h UTC
    expect(manha?.fireAt).toEqual(new Date('2026-08-28T09:00:00.000Z')); // sexta 6h SP = 9h UTC
  });

  it('TZ America/Sao_Paulo explícito cruzando meia-noite: véspera de compromisso de manhã cedo cai no dia anterior', () => {
    const now = new Date('2026-08-25T13:00:00.000Z');
    // compromisso sexta 7h SP = 10h UTC; véspera (quinta 20h SP) precisa continuar sendo quinta, não sexta.
    const event = buildEvent({ startAt: new Date('2026-08-28T10:00:00.000Z') });

    const reminders = expandChain(event, DEFAULT_SETTINGS, now);

    const vespera = reminders.find((r) => r.tipoCadeia === 'vespera');
    expect(vespera?.fireAt).toEqual(new Date('2026-08-27T23:00:00.000Z'));
  });

  it('TZ America/Sao_Paulo explícito na virada de mês: véspera de compromisso no dia 1 cai no último dia do mês anterior', () => {
    const now = new Date('2026-08-25T13:00:00.000Z');
    // compromisso 2026-09-01 14h SP = 17h UTC; véspera é 2026-08-31 20h SP = 23h UTC.
    const event = buildEvent({ startAt: new Date('2026-09-01T17:00:00.000Z') });

    const reminders = expandChain(event, DEFAULT_SETTINGS, now);

    const vespera = reminders.find((r) => r.tipoCadeia === 'vespera');
    expect(vespera?.fireAt).toEqual(new Date('2026-08-31T23:00:00.000Z'));
  });

  it('cada reminder carrega os dados que o template precisa (título, startAt, deslocamentoMin, ids)', () => {
    const now = new Date('2026-08-25T13:00:00.000Z');

    const [reminder] = expandChain(buildEvent(), DEFAULT_SETTINGS, now);

    expect(reminder).toMatchObject({
      eventId: 1,
      itemId: 10,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });
  });
});
