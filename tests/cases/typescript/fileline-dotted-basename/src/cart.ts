export class Cart {
  private items: string[] = [];

  /** adds one */
  add(x: string): void { this.items.push(x); }
}
new Cart().add('a');
