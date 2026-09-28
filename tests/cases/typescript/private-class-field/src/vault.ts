export class Vault {
  #secret: number = 1;
  label: string = 'vault';
  reveal(): number { return this.#secret; }
  #hide() { return this.label; }
  describe() { return this.#hide(); }
}

export class Ledger {
  #secret: number = 2;
  peek(): number { return this.#secret; }
}
