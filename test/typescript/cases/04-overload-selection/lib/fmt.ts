// Library overloads: the set the engine must select within lives in another IR.
export function render(v: string): string;
export function render(v: number, pad: number): string;
export function render(v: boolean): string;
export function render(v: unknown, pad?: number): string {
  return String(v) + String(pad);
}
export class Codec {
  encode(v: string): string;
  encode(v: number): string;
  encode(v: unknown): string {
    return String(v);
  }
}
