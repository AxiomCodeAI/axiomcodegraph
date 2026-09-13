export class Item { run() { return 1; } tag() { return 2; } }
export function build() {
  const items = [new Item(), new Item()];
  items[0].run();
  items.push(new Item());
  items.forEach((it) => it.run());
  const tags = items.map((it) => it.tag());
  const found = items.find((it) => it.run() === 1);
  found.run();
  for (const it of items) { it.run(); }
  for (let i = 0; i < items.length; i++) { items[i].tag(); }
  const [first] = items;
  first.run();
  /** @type {Item[]} */
  const typed = [];
  typed[0].run();
  /** @type {Array<Item>} */
  const generic = [];
  generic.forEach((g) => g.tag());
  return tags;
}
export function collections() {
  const byName = new Map();
  byName.set('a', new Item());
  byName.get('a').run();
  byName.forEach((it) => it.tag());
  const seen = new Set();
  seen.add(new Item());
  for (const it of seen) it.run();
  [...seen].forEach((it) => it.tag());
  /** @param {string} s */
  const shout = (s) => s.toUpperCase();
  return shout('x');
}
