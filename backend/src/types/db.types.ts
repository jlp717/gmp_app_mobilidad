/**
 * Database Type Definitions
 */

export interface QueryResult<T = Record<string, unknown>[]> {
  data: T;
  rowCount: number;
  executionTime: number;
}
