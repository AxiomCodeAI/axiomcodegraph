class Cart {
  constructor() { this.items = []; }

  /** adds one */
  add(x) { this.items.push(x); }
}
new Cart().add('a');
module.exports = { Cart };
