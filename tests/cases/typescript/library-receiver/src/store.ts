export class Store {
  get(id: string): string { return id; }
}

export class Reader {
  store = new Store();
  read(id: string): string { return this.store.get(id); }
}

export function lookup(anything: any): unknown {
  return anything.get(1);
}
