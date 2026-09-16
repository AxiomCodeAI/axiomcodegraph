export interface Sink { write(s: string): void; }

export class FileSink implements Sink {
  write(s: string): void { this.flush(s); }
  flush(s: string): void { }
}

export function emit(sink: Sink, s: string): void { sink.write(s); }

export function main(): void { emit(new FileSink(), "x"); }
