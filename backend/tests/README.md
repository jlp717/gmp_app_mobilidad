# Backend tests

- Unit/controller/security tests run without DB2.
- GMP_TEST_DB2=1 npx jest tests/repositories/javier-db2.integration.test.js --runInBand enables read-only integration against schema JAVIER through existing ODBC pool.
- CI skips DB2 integration because hosted runners cannot reach AS400. Integration test never accesses DSEDAC and persists no fixture rows; TEST_P8_ is only a bound trace marker.
