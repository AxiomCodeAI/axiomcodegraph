// fixture: type-references/reference-contexts
// nature: runtime-bearing
//
// One type, referenced from every syntactic context a type reference can
// occupy. This is the TypeScript port of Java's TypeRefContext enumeration:
// parameter, return, field, local, type argument, heritage, bound, cast.
//
// TypeScript adds contexts Java has no position for -- the type argument of a
// `new` expression, an explicit type argument on a call, an `as` assertion, a
// type predicate, an assertion signature, a `this` parameter, an index
// signature value, and the type of a rest parameter -- and drops one Java has:
// a throws clause. See MANIFEST.md.

export interface Session {
    readonly id: string;
    readonly userId: string;
}

export interface User {
    readonly id: string;
    readonly roles: readonly string[];
}

export class Clock {
    now(): number {
        return Date.now();
    }
}

// --- field / property declarations ----------------------------------------

export class SessionStore {
    // property type annotation
    private readonly sessions: Map<string, Session> = new Map();

    // property with an inferred type from a `new` expression's type arguments
    private readonly clock = new Clock();

    // optional property
    lastError?: Error;

    // definite assignment assertion: declared here, assigned by an initialiser
    current!: Session;

    // readonly array property
    readonly auditLog: readonly string[] = [];

    // property whose type is a function type
    onEvict: ((session: Session) => void) | undefined;

    // index signature: the value position is a type reference
    [extra: string]: unknown;

    // --- parameter and return positions -----------------------------------

    // parameter type + return type
    find(id: string): Session | undefined {
        return this.sessions.get(id);
    }

    // optional parameter
    findOrDefault(id: string, fallback?: Session): Session | undefined {
        return this.sessions.get(id) ?? fallback;
    }

    // parameter with a default value whose type is inferred
    list(limit = 10): Session[] {
        return [...this.sessions.values()].slice(0, limit);
    }

    // rest parameter, whose declared type is an array type
    addAll(...sessions: Session[]): void {
        for (const session of sessions) {
            this.sessions.set(session.id, session);
        }
    }

    // destructured parameter with an object type annotation
    query({ userId, limit }: { userId: string; limit: number }): Session[] {
        return this.list(limit).filter((session) => session.userId === userId);
    }

    // a `this` parameter: a type reference in a position Java has no syntax for
    describe(this: SessionStore): string {
        return `${this.sessions.size} sessions`;
    }

    // type parameter bound, and a type argument inside the return type
    groupBy<K extends keyof Session>(field: K): Map<Session[K], Session[]> {
        const groups = new Map<Session[K], Session[]>();
        for (const session of this.sessions.values()) {
            const key = session[field];
            const bucket = groups.get(key) ?? [];
            bucket.push(session);
            groups.set(key, bucket);
        }
        return groups;
    }

    touch(): number {
        return this.clock.now();
    }
}

// --- local variable annotations, in several forms -------------------------

export function localAnnotations(store: SessionStore): number {
    // annotated local
    const session: Session | undefined = store.find("a");

    // local annotated with a generic type
    const seen: Set<string> = new Set<string>();

    // local whose type comes from an explicit type argument on a call
    const ids = Array.from<string>(seen);

    // local annotated with a function type
    const format: (session: Session) => string = (s) => s.id;

    if (session !== undefined) {
        seen.add(format(session));
    }
    return ids.length + seen.size;
}

// --- type arguments on `new` expressions ----------------------------------

export function typeArgumentsOnNew(): Map<string, ReadonlyArray<Session>> {
    const byUser = new Map<string, ReadonlyArray<Session>>();
    const empty = new Set<Session>();
    byUser.set("u1", [...empty]);
    return byUser;
}

// --- explicit type arguments on a generic call ---------------------------

function pick<T>(items: readonly T[], index: number): T | undefined {
    return items[index];
}

export function explicitCallTypeArguments(users: readonly User[]): User | undefined {
    return pick<User>(users, 0);
}

// --- `as` assertion, the cast position ------------------------------------

export function assertionPositions(raw: unknown): User {
    const user = raw as User;
    const roles = (raw as { roles?: readonly string[] }).roles ?? [];
    void roles;
    return user;
}

// --- type predicate and assertion signature, both type-reference positions -

export function isSession(value: unknown): value is Session {
    return typeof value === "object" && value !== null && "userId" in value;
}

export function assertIsUser(value: unknown): asserts value is User {
    if (!isSession(value) && typeof value !== "object") {
        throw new TypeError("not a user");
    }
}

// --- a type reference qualified by a namespace-like value ----------------

export function qualifiedReferences(): Map<string, Set<string>> {
    const outer: Map<string, Set<string>> = new Map();
    outer.set("k", new Set(["v"]));
    return outer;
}
