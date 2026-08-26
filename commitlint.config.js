/**
 * Conventional Commits — configuracion del equipo GMP App Movilidad.
 * Tipos permitidos (cerrados): feat|fix|docs|style|refactor|test|chore|perf|ci|revert
 * Politica de tamano y ejemplos: docs/CONTRIBUTING.md
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci', 'revert'],
    ],
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 120],
  },
};
