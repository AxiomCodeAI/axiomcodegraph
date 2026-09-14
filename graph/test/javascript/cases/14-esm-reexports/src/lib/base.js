export class Base { id() { return 'base'; } static make() { return new this(); } }
export function util() { return 'util'; }
export const arrow = () => util();
export let mutable = () => 'first';
export function swap() { mutable = () => 'second'; }
const local = () => 'local';
export { local as renamed, local as default };
export const obj = { m() { return 'm'; } };
export const inst = new Base();
