// A FUNCTION WRAPPED BY A LIBRARY CALL AND KEPT IN A CONST. `wrap` is a declaration only, so the const holds
// what a library returns; the function literal it was handed is what a registration of the const runs.
declare function wrap<F>(f: F): F

export function migrate(): void {}

export const plugin = wrap(async () => {
  migrate()
})

// CONTROL: a const holding a plain value built by a library call hands over no function
export const settings = wrap(42)
