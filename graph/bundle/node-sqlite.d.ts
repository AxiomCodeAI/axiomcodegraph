/**
 * The slice of `node:sqlite` this package uses. Node ships the module from 22.5; the
 * installed @types/node predates it, so the four members used here are declared locally
 * rather than pulling a newer type package for one import.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: (string | number | null)[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
