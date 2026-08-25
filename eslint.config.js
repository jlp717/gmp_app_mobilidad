// ESLint 9 flat config — GMP App Mobilidad (raiz + backend JS).
// Backend TS mantiene su propio lint en backend/.eslintrc.cjs (eslint 8 + @typescript-eslint 6).
// no-floating-promises requiere parseo type-aware de TS: pendiente migrar backend a typescript-eslint v8
// antes de activarlo aqui. Registrado en INFORME_CALIDAD_BASELINE.md.

const jsGlobals = require('globals');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'build/**',
      'lib/**',
      'android/**',
      'ios/**',
      'web/**',
      'windows/**',
      'linux/**',
      'macos/**',
      '.dart_tool/**',
      '.opencode/**',
      '.opencode-runtime/**',
      'vault/**',
      'docs/**',
      'uploads/**',
      'logs/**',
      'database_backup_*/**',
      'venv/**',
      '.venv/**',
      'ipex_ollama/**',
      'pixel-agents/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...jsGlobals.node,
        ...jsGlobals.es2021,
      },
    },
    rules: {
      // Strict baseline exigido por el estandar del equipo.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'require-await': 'error',

      // Errores reales, no estilo.
      'no-async-promise-executor': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty-pattern': 'error',
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-self-compare': 'error',
      'no-sparse-arrays': 'error',
      'no-template-curly-in-string': 'warn',
      'no-undef-init': 'error',
      'no-unreachable-loop': 'error',
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-shadow-restricted-names': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-proto': 'error',
      'no-return-await': 'error',
      'no-throw-literal': 'error',
      'no-with': 'error',
      'object-shorthand': ['error', 'properties'],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      radix: 'error',
      yoda: 'error',
    },
  },
];
