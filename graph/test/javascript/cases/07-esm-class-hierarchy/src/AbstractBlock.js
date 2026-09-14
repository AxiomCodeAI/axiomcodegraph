import Node from './Node.js';
export default class AbstractBlock extends Node {
  constructor(component) { super(component); }
  walk() { super.walk(); this.component.error(this); }
}
