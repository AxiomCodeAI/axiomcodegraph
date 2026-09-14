// Overloads separated by PRIMITIVE parameter type and by ARITY.
// The declaration order is deliberately hostile: the correct answer for a `number`
// argument is the SECOND declaration, so an engine that takes declaration 0 is wrong.

export function scale(value: string, by: string): string;
export function scale(value: number, by: number): number;
export function scale(value: boolean): boolean;
export function scale(value: string | number | boolean, by?: string | number): unknown {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value * (by as number);
  return value.repeat(Number(by));
}

// Arity alone separates these three.
export function pad(text: string): string;
export function pad(text: string, width: number): string;
export function pad(text: string, width: number, fill: string): string;
export function pad(text: string, width = 8, fill = ' '): string {
  return text.padStart(width, fill);
}
