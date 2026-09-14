import AbstractBlock from './AbstractBlock.js';
export default class Component {
  warn(node) { return node; }
  error(node) { return node; }
  run() {
    const block = new AbstractBlock(this);
    block.add(new AbstractBlock(this)).walk();
    const copy = block.clone();
    copy.walk();
    /** @type {import('./Node.js').default} */
    const n = block;
    n.walk();
    return copy;
  }
}
new Component().run();
