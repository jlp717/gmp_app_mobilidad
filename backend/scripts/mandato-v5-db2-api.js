'use strict';

const env = process['env'];
const required = ['MANDATO_A', 'MANDATO_B', 'DB2_CONNECT'];
const missing = required.filter((name) => !env[name]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

throw new Error('Live DB2/API verifier disabled until it is wired to env-only runtime values.');
