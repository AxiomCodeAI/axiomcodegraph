import { StateCreator, StoreApi } from './store'

// The middleware: its inner arrow's parameters carry no annotation and are typed by LoggerImpl's
// declared return type.
type LoggerImpl = <T>(fn: StateCreator<T>) => StateCreator<T>

const loggerImpl: LoggerImpl = (fn) => (set, get, api) => {
  const logged: typeof set = (partial: any, replace?: any) => {
    set(partial, replace)
    console.log(get())
  }
  console.log(api.getState())
  return fn(logged, get, api)
}
export const logger = loggerImpl

// The same types written as annotations: nothing contextual.
export function explicitlyTyped<T>(set: StoreApi<T>['setState'], get: StoreApi<T>['getState']): T {
  set({})
  return get()
}

// CONTROLS. An index that is not one literal names a union over several members, and a conditional
// alias bound to a non-literal key is the same question: both stay unresolved rather than picking one.
type Pick1<T, K> = K extends keyof T ? T[K] : never
export function controlUnionKey<T>(
  f: StoreApi<T>['getState' | 'getInitialState'],
  g: Pick1<StoreApi<T>, 'getState' | 'getInitialState'>,
): void {
  f()
  g()
}
