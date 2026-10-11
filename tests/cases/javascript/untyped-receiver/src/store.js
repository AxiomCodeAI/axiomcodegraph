export class Store {
  get(id) { return id; }
}

export class Reader {
  constructor() { this.store = new Store(); }
  read(id) { return this.store.get(id); }
}

export function lookup(anything) {
  return anything.get(1);
}
