export class Walker {
  step(n: number): number {
    return n <= 0 ? 0 : this.step(n - 1);
  }
}
export function bounce(n: number): number {
  return n <= 0 ? 0 : bounce(n - 1);
}
