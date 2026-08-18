'use strict';

// Restored for ESLint 8 + @typescript-eslint v6 already in package.json.
// npm run lint targets src/**/*.ts; CI also lints routes/services/middleware JS.
// No extra style pack: eslint:recommended + plugin:@typescript-eslint/recommended
// (same family as existing eslint-disable @typescript-eslint/no-var-requires).
module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
    commonjs: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
  extends: ['eslint:recommended'],
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/'],
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['plugin:@typescript-eslint/recommended'],
    },
  ],
};
