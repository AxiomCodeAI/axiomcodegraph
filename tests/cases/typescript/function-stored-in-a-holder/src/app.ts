type GetPath = (url: string) => string

export const getPath = (url: string): string => url.split('?')[0]!
export const getPathLoose = (url: string): string => url

export class App {
  readonly getPath: GetPath
  fetch: (url: string) => string = (url) => {
    return this.dispatch(url)
  }
  constructor(options: { getPath?: GetPath; strict?: boolean } = {}) {
    this.getPath = (options.strict ?? true) ? (options.getPath ?? getPath) : getPathLoose
  }
  dispatch(url: string): string {
    return this.getPath(url)
  }
}

export function handle(app: App) {
  return (url: string) => app.fetch(url)
}

export function runTask<T>(task: () => T): T {
  return retry(task)
}

function retry<T>(fn: () => T): T {
  return fn()
}

export function load(): string {
  return runTask(() => new App().fetch('/a?b'))
}

type Format = (n: number) => string

// Never constructed: only its static method is used, as a VALUE.
export class Formats {
  static money(n: number): string {
    return '$' + n
  }
}

// Never constructed in this program either: a Registry arrives from outside, and the
// function lives in its annotated field.
export class Registry {
  format: Format = Formats.money
}

export function price(registry: Registry, n: number): string {
  return registry.format(n)
}

export function checkout(registry: Registry): string {
  return price(registry, 3)
}
