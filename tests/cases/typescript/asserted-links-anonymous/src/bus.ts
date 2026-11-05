export class Bus {
  private readonly listeners: Array<(x: string) => void> = [];

  on(listener: (x: string) => void): void {
    this.listeners.push(listener);
  }

  emit(x: string): void {
    for (const listener of this.listeners) {
      listener(x);
    }
  }
}
