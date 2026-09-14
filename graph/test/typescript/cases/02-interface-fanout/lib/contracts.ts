export interface Sink {
  accept(value: string): void;
}
export class ConsoleSink implements Sink {
  accept(value: string): void {}
}
