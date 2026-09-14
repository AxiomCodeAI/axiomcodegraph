// fixture: type-system/type-only/default-type-export (support module)
// nature: type-only
//
// A module whose default export is an interface, so `import type Default from`
// resolves to a type with no runtime counterpart.

export default interface DefaultContract {
    readonly name: string;
}
