import { Shelf } from './store.js';

export class Client {
  constructor() {
    this.cache = new Map();
    this.shelf = new Shelf();
  }
  load(id) {
    return this.shelf.fetch(id);
  }
  cached(res) {
    return res.fetch('x');
  }
}

export function remote(api) {
  return api.fetch('/orders');
}
