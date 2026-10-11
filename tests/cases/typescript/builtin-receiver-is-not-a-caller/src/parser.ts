export class FrameParser {
  parse(text: string): number { return text.length }
  forEach(f: (n: number) => void): void { f(1) }
}
export class Queue {
  resolve(id: string): string { return id }
}
