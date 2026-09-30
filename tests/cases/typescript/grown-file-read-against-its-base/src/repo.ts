export interface Clock { now(): number }
export interface Logger { warn(m: string): void }
export interface Gateway { pay(n: number): Promise<number> }
export interface Event { id: string }
export interface Report { id: string }
export interface Repo {
  run<T>(f: () => Promise<T>): Promise<T>;
  find(id: string): Promise<number>;
}
