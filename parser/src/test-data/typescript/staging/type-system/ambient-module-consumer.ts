// fixture: type-system/ambient-module-consumer
// nature: runtime-bearing
//
// Imports resolved entirely by ambient module declarations in
// ambient-module.d.ts. No file on disk backs any of these specifiers: the
// import edge exists, the target module does not. Every call below is
// therefore an ambient call site reached through an import.

import main, { transform, version, type TransformOptions } from "untyped-legacy-package";
import logo from "./logo.svg";
import analytics = require("@vendor/analytics");

export function useAmbientModule(input: string): string {
    const options: TransformOptions = { pretty: true };
    const output = transform(input, options);
    main();
    return `${output}@${version}`;
}

export function useWildcardModule(): string {
    return logo;
}

export function useExportEqualsModule(name: string): void {
    analytics.track({ name, payload: { source: "fixture" } });
}
