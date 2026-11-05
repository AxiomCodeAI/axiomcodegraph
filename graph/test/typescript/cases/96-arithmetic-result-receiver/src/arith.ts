// A call on the RESULT of an arithmetic operator. The operators below yield a number
// (or a bigint when the operands are bigints), so the receiver is Number's or BigInt's.
export function elapsed(start: number, end: number): string {
  return (end - start).toFixed(1);
}
export function ratio(a: number, b: number): string {
  return (a / b).toFixed(2);
}
export function scaled(a: number): string {
  return (a * 3 % 7).toString(16);
}
export function power(a: number): string {
  return (a ** 2).toFixed(0);
}
export function masked(a: number): string {
  return (a & 0xff).toString(2);
}
export function negated(a: number): string {
  return (-a).toFixed(0);
}
export function parsed(s: string): string {
  return (+s).toFixed(0);
}
export function total(a: number, b: number): string {
  return (a + b).toFixed(1);
}
export function bigDiff(a: bigint, b: bigint): string {
  return (a - b).toString();
}
export function bigNeg(a: bigint): string {
  return (-a).toString();
}

// controls: a `+` with a string operand is a concatenation and stays String's alone,
// and a bigint result never names Number's declaration.
export function joined(s: string, n: number): string {
  return (s + n).toString();
}
export function joinedTrim(s: string, n: number): string {
  return (n + s).trim();
}
