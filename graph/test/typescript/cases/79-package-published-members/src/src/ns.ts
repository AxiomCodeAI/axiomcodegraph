// The exported functions of an exported namespace.
export namespace Result {
  export function ok(x: number) { return { ok: true, x }; }
  // CONTROL: a namespace function that is not exported is not published.
  function hidden() { return 0; }
}
