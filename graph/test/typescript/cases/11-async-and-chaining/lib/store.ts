export class Record {
  key(): string {
    return "k";
  }
}
export class Store {
  async load(): Promise<Record> {
    return new Record();
  }
  self(): Store {
    return this;
  }
}
