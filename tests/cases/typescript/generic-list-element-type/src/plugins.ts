// an object type written as a type alias: the element has members and no declaration to dispatch on
export type Plugin<Name extends string> = { name: Name; setup(app: unknown): number }
export function routerSetup(): number { return 4 }
export function storeSetup(): number { return 5 }
export const routerPlugin = (): Plugin<"router"> => ({ name: "router", setup() { return routerSetup() } })

export function install(plugins: Plugin<any>[]): number[] {
  return plugins.map((p) => p.setup(null))
}
// a generic list of them, iterated in a closure the builder returns
export function buildApp<Ps extends [Plugin<any>, ...Plugin<any>[]]>(...plugins: Ps) {
  return function start(app: unknown): number[] {
    return plugins.map((p) => p.setup(app))
  }
}
// CONTROL: the element's shape is not a Plugin: its setup is not Plugin's, so nothing reaches routerSetup
export type Hook = { setup(): number }
export const storeHook = (): Hook => ({ setup() { return storeSetup() } })
export function runHooks(hooks: Hook[]): number[] {
  return hooks.map((h) => h.setup())
}
