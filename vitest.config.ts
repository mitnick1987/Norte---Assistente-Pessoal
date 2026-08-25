import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/app.ts',
        'src/**/index.ts',
        'src/**/*.d.ts',
        'src/core/kernel/types.ts',
        'src/core/channel/channel.ts',
        'src/core/outbox/alerter.ts',
      ],
    },
  },
});
