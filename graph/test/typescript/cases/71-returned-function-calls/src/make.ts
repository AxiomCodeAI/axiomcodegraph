// Functions that hand back a function. Nothing at the call sites below names what runs.
export interface Monoid<A> { readonly empty: A }

export function blockMake(n: number) {
  return (x: number): number => x + n
}

export const conciseMake = (n: number) => (x: number): number => x + n

export const curried = (n: number) => (x: number) => (y: number): number => x + y + n

export const compact = <E>(M: Monoid<E>): E => M.empty
