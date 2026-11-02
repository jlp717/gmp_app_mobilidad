#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..', '..');
const eslintCli = path.resolve(
  path.dirname(require.resolve('eslint')),
  '..',
  'bin',
  'eslint.js',
);
const result = spawnSync(
  process.execPath,
  [
    eslintCli,
    '--config',
    path.join(backendRoot, '.eslintrc.cjs'),
    'src/**/*.ts',
    '--quiet',
  ],
  {
    cwd: backendRoot,
    env: {
      ...process.env,
      ESLINT_USE_FLAT_CONFIG: 'false',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  process.stderr.write('Unable to start the TypeScript ESLint gate.\n');
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
