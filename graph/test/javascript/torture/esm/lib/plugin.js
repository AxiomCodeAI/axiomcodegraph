import Square from './shapes.js';
import { Shape } from './barrel.js';
export default function makePlugin(name) { return { name, run: () => Square.create(name), base: () => Shape.create(name) }; }
export const anon = class extends Square { own() { return this.describe(); } };
