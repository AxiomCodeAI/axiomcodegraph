// fixture: imports/import-forms
// nature: runtime-bearing
//
// Port of Java's `ImportStylePatterns.java`, and the category where the two
// languages' models diverge sharply.
//
// Java resolves an import against a CLASSPATH by fully-qualified name, and an
// import binds a type. TypeScript resolves against the FILE SYSTEM by module
// specifier, and an import binds a name that may be a value, a type, or both.
// Consequences the parser has to carry:
//   - `import type` and inline `type` specifiers are ERASED: they must never
//     produce a runtime or call-graph edge
//   - a default import binds a name chosen at the import site, not at the
//     declaration site
//   - a side-effect import binds nothing and is still an edge
//   - `import x = require()` and `export =` are TypeScript-only forms that
//     survive only in CommonJS
//
// Java's static imports and wildcard imports have no direct analogue; the
// nearest are named imports and `import * as ns`. See MANIFEST.md.

// --- default import ------------------------------------------------------
import createId from "./pkg/util";

// --- named imports -------------------------------------------------------
import { hasRole, formatUser } from "./pkg/util";

// --- named import with renaming -----------------------------------------
import { DEFAULT_ROLE as fallbackRole } from "./pkg/util";

// --- default and named on one statement ---------------------------------
import makeId, { Clock } from "./pkg/util";

// --- namespace import (the nearest thing to Java's wildcard import) -----
import * as util from "./pkg/util";

// --- type-only import: erased, never a runtime edge ---------------------
import type { Session, User } from "./pkg/models";

// --- type-only namespace import -----------------------------------------
import type * as models from "./pkg/models";

// --- inline type specifiers mixed with value specifiers -----------------
import { type Role, type User as AlsoUser } from "./pkg/models";
import { DEFAULT_ROLE } from "./pkg/util";

// --- import from a barrel, resolving through index.ts -------------------
import { SystemClock, formatUser as formatViaBarrel } from "./pkg";

// --- side-effect-only import: binds nothing ----------------------------
import "./pkg/side-effects";

// --- consumption sites, so each binding above is genuinely used --------

const clock = new Clock();
const barrelClock = new SystemClock();

export function describe(user: User): string {
    const id = createId(1);
    const alsoId = makeId(2);
    const viaNamespace = util.formatUser(user);
    return [
        id,
        alsoId,
        formatUser(user),
        formatViaBarrel(user),
        viaNamespace,
        util.DEFAULT_ROLE,
        fallbackRole,
        DEFAULT_ROLE,
        String(hasRole(user, "admin")),
        String(clock.now()),
        String(barrelClock.now()),
    ].join("|");
}

// --- type-only bindings used only in type positions -------------------

export function sessionOwner(session: Session, index: models.UserId): string {
    return `${session.userId}${index}`;
}

export function roleOf(role: Role, user: AlsoUser): string {
    return `${role}:${user.id}`;
}

// --- dynamic import: a runtime call that returns a Promise of the module -

export async function loadLazily(seed: number): Promise<string> {
    const mod = await import("./pkg/util");
    return mod.default(seed);
}

// --- dynamic import of a barrel, destructured at the await site --------

export async function loadNamed(user: User): Promise<string> {
    const { formatUser: format } = await import("./pkg");
    return format(user);
}

// --- dynamic import inside a conditional: the code-splitting idiom ----

export async function conditionalLoad(enabled: boolean): Promise<number> {
    if (!enabled) {
        return 0;
    }
    const { SystemClock: LazyClock } = await import("./pkg");
    return new LazyClock().now();
}

// --- a re-export declared in a consuming module -----------------------

export { hasRole } from "./pkg/util";
export type { Session } from "./pkg/models";
