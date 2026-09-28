// An exported class of a published module: its public members are the API.
export class Store {
  get() { return 1; }
  static create() { return new Store(); }
  // CONTROL: private and #private members are not reachable from a consumer.
  private secret() { return 2; }
  #hidden() { return 3; }
}

// CONTROL: a class that is declared but not exported publishes nothing.
class Internal {
  run() { return 4; }
}
export const internalCount = 1;
