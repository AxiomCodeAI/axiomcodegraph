// SAME module name and SAME exported names as the client's own alpha.ts. If the
// engine keys on the simple name rather than the module, these collide.
export class Service {
  run(): string {
    return "lib-alpha";
  }
}
export function process(): string {
  return "lib-alpha-process";
}
