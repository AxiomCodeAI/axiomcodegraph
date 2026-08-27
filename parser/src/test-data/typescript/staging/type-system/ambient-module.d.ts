// fixture: type-system/ambient-module.d.ts
// nature: type-only
//
// A declaration FILE: a .d.ts has no emit at all, by construction. This is the
// shape `@types/*` packages ship in, and the reason third-party types are
// always available in TypeScript in a way Python's never were.
//
// It carries the two ambient-module forms that cannot appear in a module file,
// because there they would be read as augmentations of an existing module
// rather than declarations of a new one.

// --- a module that exists at runtime but ships no types ------------

declare module "untyped-legacy-package" {
    export interface TransformOptions {
        readonly pretty?: boolean;
    }

    export function transform(input: string, options?: TransformOptions): string;
    export const version: string;
    export default function main(): void;
}

// --- a wildcard module declaration: the asset-import idiom --------

declare module "*.svg" {
    const content: string;
    export default content;
}

declare module "*.json" {
    const value: unknown;
    export default value;
}

// --- a scoped-package declaration, with a nested namespace -------

declare module "@vendor/analytics" {
    namespace analytics {
        interface Event {
            readonly name: string;
            readonly payload?: Record<string, unknown>;
        }
        function track(event: Event): void;
    }
    export = analytics;
}
