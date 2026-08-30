// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

// Fronteiras de módulo do ARCHITECTURE.md §2, impostas por ferramenta (ADR-011):
// core nunca importa de modules; um módulo só importa core e o contrato público
// de tasks (quando existir); módulo não importa interno de outro módulo.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.claude/**', 'infra/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // Sem isso o plugin não resolve import `./foo.js` para o `./foo.ts`
      // real (padrão NodeNext/ESM do projeto) e trata todo import interno
      // como "unknown", deixando a regra de fronteiras sem efeito.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/*' },
        // module-public precisa vir antes de module (mesmo motivo do par
        // abaixo): o matcher do plugin usa o primeiro pattern que casar, e
        // "público" é sempre o caso mais específico do que "módulo inteiro".
        // `integrations/*` tem um nível a mais (ARCHITECTURE.md §2: cada
        // conector é seu próprio módulo plugável, ex. `integrations/google-calendar`,
        // `integrations/gmail`) — sem esses dois patterns antes do genérico,
        // todo arquivo dentro de `integrations/*/**` capturaria "integrations"
        // como moduleName e nenhum conector teria fronteira própria.
        { type: 'module-public', pattern: 'src/modules/integrations/*/public', capture: ['moduleName'] },
        { type: 'module', pattern: 'src/modules/integrations/*', capture: ['moduleName'] },
        { type: 'module-public', pattern: 'src/modules/*/public', capture: ['moduleName'] },
        { type: 'module', pattern: 'src/modules/*', capture: ['moduleName'] },
        { type: 'infra-ops', pattern: 'src/infra-ops/*' },
        { type: 'app', pattern: 'src/app.ts' },
      ],
      'boundaries/ignore': ['**/*.test.ts'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // core nunca conhece módulos concretos — só a interface ModuleManifest.
            { from: 'core', allow: ['core'] },
            // módulo só importa core e a fronteira pública de outros módulos (hoje só tasks, FEAT-002+).
            { from: 'module', allow: ['core', 'module-public'] },
            { from: 'module-public', allow: ['core'] },
            { from: 'infra-ops', allow: ['core'] },
            { from: 'app', allow: ['core', 'module', 'infra-ops'] },
          ],
        },
      ],
      'boundaries/no-private': [
        'error',
        {
          // módulo só é alcançável de fora pela sua pasta public/ (contrato exportado).
          allowUncles: false,
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
);
