// fixture: imports/cjs-interop
// nature: runtime-bearing
//
// The TypeScript-only import forms, which exist because TypeScript predates
// ES modules and still has to describe CommonJS.
//
// `import x = require("...")` is an import that Java has no counterpart for at
// any level: it binds a whole module object as a single name, and it is the
// only import form that can consume an `export =` module without
// esModuleInterop. These forms are resolution-mode sensitive -- they are legal
// in a CommonJS-emitting project and an error in an ES module -- which is a
// property no Java import has.

import formatter = require("./pkg/legacy-cjs");

// an import alias: a binding to an existing name, not to a module
import Alias = formatter;

export function format(text: string): string {
    return formatter(text, { indent: 2, newline: "\n" });
}

export function formatViaAlias(text: string): string {
    return Alias(text);
}

// the type exported alongside the callable, reached through the alias
export function withOptions(options: formatter.Options): number {
    return options.indent;
}
