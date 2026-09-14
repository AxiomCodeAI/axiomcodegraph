export class Engine {
  start(): string {
    return "started";
  }
}
export function boot(): string {
  return "boot";
}
export type Options = { verbose: boolean };
