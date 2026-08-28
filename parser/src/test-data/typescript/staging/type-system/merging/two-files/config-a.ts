// fixture: type-system/merging/two-files/config-a
// nature: type-only
//
// Declaration merging across TWO FILES. These are global SCRIPTS, not modules:
// no top-level import or export, so their declarations land in the global
// scope where the checker merges them by name.
//
// This is why `isolatedModules` is off for this directory (its own
// tsconfig.json): that flag requires every file to be a module, which would
// make this merge impossible to express. Real projects hit exactly this with
// global .d.ts files.
//
// `AppConfig` here and `AppConfig` in config-b.ts are ONE symbol with two
// declarations, in two different files.

interface AppConfig {
    readonly name: string;
    readonly version: string;
}

interface Plugin {
    readonly id: string;
}
