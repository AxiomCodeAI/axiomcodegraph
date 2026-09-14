// fixture: type-system/merging/module-augmentation
// nature: runtime-bearing
//
// Declaration merging ACROSS A MODULE BOUNDARY. `declare module "./specifier"`
// reopens another module's declarations and adds to them. This is how
// web-framework middleware adds `req.user`, how Vue adds global properties, and how
// virtually every plugin ecosystem in TypeScript extends its host.
//
// The merge is directional and invisible from the other side: augmented-base.ts
// has no reference to this file, yet its `Request` gains members here. A model
// keyed on the declaring file will attribute those members to the wrong module,
// or miss them.

import { Application, type Request } from "./augmented-base";

// --- augmenting an interface exported by another module -------------

declare module "./augmented-base" {
    // members added to the EXISTING Request interface
    interface Request {
        user?: { readonly id: string; readonly roles: readonly string[] };
        readonly startedAt: number;
    }

    // a second interface augmented in the same block
    interface Session {
        readonly userId: string;
    }

    // a brand-new type introduced into the other module's namespace
    interface AuditEntry {
        readonly action: string;
        readonly at: number;
    }
}

// --- augmenting a GLOBAL type from inside a module -----------------

declare global {
    interface Array<T> {
        last(): T | undefined;
    }

    // eslint-disable-next-line no-var
    var __appVersion: string | undefined;
}

// --- the augmented members, used ---------------------------------

export function authenticate(request: Request): string {
    // `user` and `startedAt` exist only because of the augmentation above
    const id = request.user?.id ?? "anonymous";
    const elapsed = Date.now() - request.startedAt;
    return `${id}@${elapsed}`;
}

export function install(app: Application): number {
    return app
        .use((request) => {
            void authenticate(request);
        })
        .handle({ url: "/", headers: new Map(), startedAt: Date.now() });
}

export function useGlobalAugmentation(items: readonly string[]): string {
    // `last` exists only because of the `declare global` block
    const tail = [...items].last();
    globalThis.__appVersion = "1.0.0";
    return tail ?? "";
}
