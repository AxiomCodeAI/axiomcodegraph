export class Vault {
  #secret = 1;
  label = 'vault';
  reveal() { return this.#secret; }
  #hide() { return this.label; }
  describe() { return this.#hide(); }
}

export class Ledger {
  #secret = 2;
  peek() { return this.#secret; }
}
