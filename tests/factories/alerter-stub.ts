import { vi } from 'vitest';
import type { FailureAlerter } from '../../src/core/outbox/alerter.js';

/** Stub completo de `FailureAlerter` — todo método vira `vi.fn()`, sobrescrevível por teste. */
export function buildAlerterStub(overrides: Partial<FailureAlerter> = {}): FailureAlerter {
  return {
    alertDeliveryExhausted: vi.fn(),
    alertRefreshFailure: vi.fn(),
    alertAnchorRitualCapped: vi.fn(),
    alertSessionDown: vi.fn(),
    alertDiskUsage: vi.fn(),
    alertCostBudgetExceeded: vi.fn(),
    alertCacheRegression: vi.fn(),
    ...overrides,
  };
}
