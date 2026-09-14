export interface Client {
  get(): string;
}
export interface Client {
  put(): string;
}
export function build(): string {
  return "b";
}
export namespace build {
  export function withDefaults(): string {
    return "d";
  }
}
