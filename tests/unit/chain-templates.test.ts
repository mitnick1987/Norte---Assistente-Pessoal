import { describe, expect, it } from 'vitest';
import {
  buildManhaMessage,
  buildPreparoMessage,
  buildVesperaMessage,
} from '../../src/modules/chains/domain/index.js';
import { assertToneIsSafe } from '../tone/forbidden-patterns.js';

describe('templates determinísticos da cadeia (RF-04, ADR-006)', () => {
  it('véspera menciona o compromisso e passa no filtro de tom', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildVesperaMessage('dentista', seed);
      assertToneIsSafe(message);
      expect(message).toContain('dentista');
      expect(message.split('\n')).toHaveLength(1);
    }
  });

  it('manhã menciona o compromisso e passa no filtro de tom', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildManhaMessage('dentista', seed);
      assertToneIsSafe(message);
      expect(message).toContain('dentista');
      expect(message.split('\n')).toHaveLength(1);
    }
  });

  it('alerta de saída sempre contém tempo restante formatado ("faltam N min"), nunca só o horário absoluto', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildPreparoMessage('dentista', 40, seed);
      assertToneIsSafe(message);
      expect(message).toMatch(/\d+\s*min/);
      expect(message).toContain('40');
      expect(message).not.toMatch(/\d{1,2}[:h]\d{2}/); // nunca horário absoluto tipo "14:00" ou "14h00"
    }
  });

  it('alerta de saída arredonda minutos fracionários e nunca fica negativo', () => {
    expect(buildPreparoMessage('dentista', 39.6, 0)).toMatch(/\b40\b/);
    expect(buildPreparoMessage('dentista', -5, 0)).toMatch(/\b0\b/);
  });

  it('todas as variações de véspera/manhã/preparo passam no filtro de tom', () => {
    for (let seed = 0; seed < 20; seed++) {
      assertToneIsSafe(buildVesperaMessage('x', seed));
      assertToneIsSafe(buildManhaMessage('x', seed));
      assertToneIsSafe(buildPreparoMessage('x', 10, seed));
    }
  });
});
