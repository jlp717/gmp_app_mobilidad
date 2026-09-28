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
      '.obsidian/**',
      '.codex/**',
      '.claude/**',
      '.continue/**',
      '.cursor/**',
      '.qoder/**',
      '.trae/**',
      '.windsurf/**',
      '.omo/**',
      '.openclaw/**',
      '.remember/**',
      '.swarm/**',
      'skills/**',
      'assets/load_planner/lib/**',
      '**/*.min.js',
      '**/*.global.js',
      '**/*.tmp',
      '**/*.bak',
      '**/*.orig',
      'backend/kpi/tmp/**',
      // RATCHET L-tier1 (excluidos: no parsean como JS y son legacy no
      // distribuido; ni warn es posible — el parser falla antes que las
      // reglas. Ninguno lo importa codigo vivo. Lote futuro: borrar o
      // reparar. Causas verificadas 2026-09-28:
      // - backend/scripts/archive/**: one-offs congelados con shebang en
      //   linea 2 (tras comentario) -> "Unexpected character '!'"
      // - create_v_dim_cliente/execute-vista-unificada/whatsapp-baileys-pair:
      //   mismo shebang desplazado.
      // - backend/audit/scripts/fix_anomalies.js: JS roto (audit one-off).
      // - snapshots/**/ddd-adapters.js: backup corrupto (unicode escape).
      // - .opencode-legacy/state/cert-v6-safe.js: state legacy no-JS.
      'backend/scripts/archive/**',
      'backend/scripts/create_v_dim_cliente.js',
      'backend/scripts/execute-vista-unificada.js',
      'backend/scripts/whatsapp-baileys-pair.js',
      'backend/audit/scripts/fix_anomalies.js',
      '.opencode-legacy/snapshots/**/ddd-adapters.js',
      '.opencode-legacy/state/cert-v6-safe.js',
    ],
  },
  {
    // RATCHET L-tier1 (legacy): todo *.js NO listado en el bloque estricto
    // Tier-1 de abajo reporta en warn. `npx eslint .` sale exit 0 pero la
    // deuda sigue visible. Plan de conversion por lotes en 05_BACKLOG_PENDIENTE.md.
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
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['warn', 'smart'],
      'no-implicit-coercion': ['warn', { allow: ['!!'] }],
      'require-await': 'warn',

      // Errores reales, no estilo.
      'no-async-promise-executor': 'warn',
      'no-cond-assign': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-dupe-keys': 'warn',
      'no-duplicate-case': 'warn',
      'no-empty-pattern': 'warn',
      'no-fallthrough': 'warn',
      'no-redeclare': 'warn',
      'no-self-compare': 'warn',
      'no-sparse-arrays': 'warn',
      'no-template-curly-in-string': 'warn',
      'no-undef-init': 'warn',
      'no-unreachable-loop': 'warn',
      'no-use-before-define': ['warn', { functions: false, classes: false, variables: false }],
      'no-var': 'warn',
      'prefer-const': 'warn',
      'prefer-promise-reject-errors': 'warn',
      'no-shadow-restricted-names': 'warn',
      'no-eval': 'warn',
      'no-new-func': 'warn',
      'no-proto': 'warn',
      'no-return-await': 'warn',
      'no-throw-literal': 'warn',
      'no-with': 'warn',
      'object-shorthand': ['warn', 'properties'],
      'prefer-rest-params': 'warn',
      'prefer-spread': 'warn',
      radix: 'warn',
      yoda: 'warn',
    },
  },
  // RATCHET L-tier1 (estricto): superficie regulada Tier-1 (dinero +
  // seguridad + ficheros nuevos L1-L10) en error. Solo ficheros verificados
  // a 0 errores entran aqui; el resto (cobros/entregas/chatbot/facturas,
  // repartidor-*, resto de middleware/services/repositories con deuda
  // preexistente fuera de lineas Tier-1) queda en warn hasta los lotes de
  // conversion — la jaula prohibe tocarlos en este lote. auth.js excluido
  // (intocable por guardrail). Va DESPUES del bloque warn para que gane.
  {
    files: [
      'backend/routes/comercial-liquidacion.js',
      'backend/middleware/error-serializer.js',
      'backend/middleware/prometheus-metrics.js',
      'backend/middleware/logger.js',
      'backend/middleware/compression.js',
      'backend/middleware/db-timing.js',
      'backend/middleware/vendor-scope.js',
      'backend/services/analytics-service.js',
      'backend/services/commissions-service.js',
      'backend/services/objectives-service.js',
      'backend/services/circuit-breaker.js',
      'backend/services/reparto-receipt-pdf-service.js',
      'backend/services/reparto-variance-pdf-service.js',
      'backend/services/reparto-cobro-pdf-service.js',
      'backend/services/reparto-bank-catalog.js',
      'backend/services/reparto-catalog-service.js',
      'backend/services/repartidor-liquidacion-contract.js',
      'backend/services/repartidor-rutero-orden-service.js',
      'backend/repositories/analytics-repository.js',
      'backend/repositories/commissions-repository.js',
      'backend/repositories/objectives-repository.js',
      'backend/utils/sql-identifiers.js',
      'backend/instrument.js',
      'backend/tests/error-serializer.test.js',
      'backend/tests/sql-identifiers.test.js',
      'backend/tests/instrument.test.js',
      'backend/tests/prometheus-exposition.test.js',
      'backend/tests/telemetry-logger.test.js',
      'backend/tests/request-id.test.js',
      'backend/tests/cache-contract.test.js',
      'backend/tests/health-probes.test.js',
    ],
    rules: {
      // Mismo set estricto del baseline del equipo.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'require-await': 'error',
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
  {
    // k6 = ESM aunque la extension sea .js (import from 'k6/http').
    // Sin esto, el bloque warn-commonjs los rompe con parsing-error.
    files: ['**/perf/k6/*.js', 'scripts/load/*.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    // .mjs = ESM en todo el repo (antes `*/*.mjs*` solo cubria un nivel y
    // rompia con parsing-error los .mjs anidados). Fix de config, sin tocar codigo.
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    // RATCHET L-tier1 (stub temporal): 4 directivas eslint-disable en legacy
    // referencian reglas de `eslint-plugin-import` (nunca instalado en este
    // repo). Sin stub, ESLint las reporta como error severity-2 NO degradable
    // via rules. El stub las declara conocidas+off: pasan a warn (deuda
    // visible) y el gate sale exit 0. QUITAR en el lote que borre esos 4
    // comentarios (backend/services/dsedac-exports.service.js:58,
    // backend/services/whatsappBaileysService.js:85,227).
    files: [
      'backend/services/dsedac-exports.service.js',
      'backend/services/whatsappBaileysService.js',
    ],
    plugins: {
      import: {
        rules: {
          'no-dynamic-require': { create() { return {}; } },
          'no-extraneous-dependencies': { create() { return {}; } },
        },
      },
    },
    rules: {
      'import/no-dynamic-require': 'off',
      'import/no-extraneous-dependencies': 'off',
    },
  },
];
