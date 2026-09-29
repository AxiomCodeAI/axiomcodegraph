export function alpha() { return 'a'; }
export let handler = null;
export function setHandler(h) { handler = h; }
let hook = null;
export { hook };
export function setHook(h) { hook = h; }
export let fixed = null;
export const ready = () => 'r';
