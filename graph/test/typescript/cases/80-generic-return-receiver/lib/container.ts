// A dependency-injection container as a library ships it: the service's type is
// the call's own type argument, and nothing else names it.
export class Container {
  get<T>(id: symbol): T {
    return undefined as unknown as T;
  }
  bind<T>(id: symbol): Container {
    return this;
  }
}

// A generic keyed store, the library-side twin of Map.
export class Registry<V> {
  lookup(key: string): V | undefined {
    return undefined;
  }
}
