// A module-scope const read through member access, as a call argument, in a template and
// under a type query: every use of CFG / S / TOKENS below binds to THIS file's declaration.
export const CFG = { name: 'a', port: 1 } as const;
export const S = mk({});
export const TOKENS = { Store: 'store' } as const;
export let counter = 0;
// a const that holds a function is a function: its uses are calls, not reads (control)
export const make = (n: number) => n + 1;

export function mk(o: object): object {
  return o;
}

export function localUse(): string {
  return CFG.name;
}

export function bump(): void {
  counter += 1;
  counter = 0;
}
