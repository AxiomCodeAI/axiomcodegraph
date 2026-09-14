/** @typedef {import('./Component.js').default} Component */
export default class Node {
  /** @type {Component} */
  component;
  /** @param {Component} component */
  constructor(component) { this.component = component; this.children = []; }
  walk() { this.component.warn(this); this.children.forEach((c) => c.walk()); }
  add(child) { this.children.push(child); return this; }
  clone() { return new this.constructor(this.component); }
}
export function helper() { return 1; }
