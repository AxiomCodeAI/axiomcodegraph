// A MIDDLEWARE RECEIVES FUNCTIONS AS PARAMETERS (#838). `(set, get, api) => ...` is written with no
// annotation: each parameter is typed by the function type the middleware is declared to return, and
// that type reaches the store's functions only through an indexed access (`StoreApi<T>['setState']`),
// a conditional alias (`Get<T, K, F>`), and a member whose type is itself an indexed access over a
// type literal's method (`SetStateInternal`). Each call below resolves to the signature the compiler
// names, and the store's own `setState`/`getState` arrows are its dispatch candidates.
type SetStateInternal<T> = {
  _(partial: T | Partial<T>, replace?: false): void
  _(state: T, replace: true): void
}['_']

export interface StoreApi<T> {
  setState: SetStateInternal<T>
  getState: () => T
  getInitialState: () => T
  subscribe: (listener: (state: T, prev: T) => void) => () => void
}

export interface StoreMutators<S, A> {}
type Get<T, K, F> = K extends keyof T ? T[K] : F
export type Mutate<S, Ms> = Ms extends []
  ? S
  : Ms extends [[infer Mi, infer Ma], ...infer Mrs]
    ? Mutate<StoreMutators<S, Ma>[Mi & keyof StoreMutators<S, Ma>], Mrs>
    : never

export type StateCreator<T, Mis extends [unknown, unknown][] = []> = ((
  set: Get<Mutate<StoreApi<T>, Mis>, 'setState', never>,
  get: Get<Mutate<StoreApi<T>, Mis>, 'getState', never>,
  api: Mutate<StoreApi<T>, Mis>,
) => T) & { $$mutators?: Mis }

export function createStore<T>(createState: StateCreator<T>): StoreApi<T> {
  let state: T
  const setState: StoreApi<T>['setState'] = (partial: T | Partial<T>, replace?: boolean) => {
    state = replace ? (partial as T) : Object.assign({}, state, partial)
  }
  const getState: StoreApi<T>['getState'] = () => state
  const subscribe: StoreApi<T>['subscribe'] = (listener) => () => listener(state, state)
  const getInitialState: StoreApi<T>['getInitialState'] = () => state
  const api: StoreApi<T> = { setState, getState, getInitialState, subscribe }
  state = createState(setState, getState, api)
  return api
}
