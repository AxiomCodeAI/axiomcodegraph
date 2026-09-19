export class App {
  #fail(e: Error): string {
    return `error: ${e.message}`;
  }
  handle(e: Error): string {
    return this.#fail(e);
  }
}
