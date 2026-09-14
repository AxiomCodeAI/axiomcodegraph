// fixture: expressions/calls-and-member-access
// nature: runtime-bearing
//
// Port of Java's `ObjectCreationTestCases.java`, `MethodReferenceExamples.java`,
// `ArrayAccessExamples.java` and `QualifiedConstructorTest.java`.
//
// This is the file the call graph is built from, so every callable form the
// language has is here: plain calls, method calls, chained calls, optional
// calls, constructor calls, super calls, tagged templates, IIFEs, .call/.apply/
// .bind, and calls through a value held in a variable or a property.
//
// Java's method references (`String::length`) have no TypeScript syntax; the
// analogue is passing the function value itself, which is included and is the
// form that makes receiver binding go wrong in real code.

export interface Row {
    readonly id: string;
    readonly score: number;
    readonly child?: Row;
    readonly tags?: readonly string[];
}

const sink: unknown[] = [];

function use(...values: unknown[]): void {
    sink.push(...values);
}

export function drain(): readonly unknown[] {
    return sink;
}

// --- the things being called ---------------------------------------------

export function freeFunction(value: number): number {
    return value * 2;
}

export function generic<T>(value: T): T {
    return value;
}

export class Service {
    static instances = 0;

    constructor(readonly name: string) {
        Service.instances++;
    }

    static create(name: string): Service {
        return new Service(name);
    }

    describe(): string {
        return this.name;
    }

    chain(): this {
        return this;
    }

    higherOrder(fn: (value: number) => number): number {
        return fn(1);
    }
}

export class Derived extends Service {
    constructor(name: string) {
        super(`derived-${name}`); // super constructor call
    }

    override describe(): string {
        // super method call
        return `[${super.describe()}]`;
    }
}

// a value namespace reached by a property chain, as `ns.Type` is in real code
const namespaces = {
    models: {
        Row: class NamespacedRow {
            constructor(readonly id: string) {}
        },
    },
};

const helpers = {
    nested: {
        deep(value: number): number {
            return value + 1;
        },
    },
    handler(value: number): number {
        return value - 1;
    },
};

// --- call forms ----------------------------------------------------------

export function callForms(service: Service, rows: readonly Row[]): void {
    // plain call
    use(freeFunction(1));

    // method call on a local
    use(service.describe());

    // static method call
    use(Service.create("s").describe());

    // qualified call through a property chain
    use(helpers.nested.deep(1), helpers.handler(2));

    // chained calls
    use(service.chain().chain().describe());

    // call with an explicit type argument
    use(generic<string>("x"), generic(1));

    // call whose argument is a call
    use(freeFunction(freeFunction(2)));

    // call whose callee is a parenthesised expression
    use((freeFunction)(3));

    // call through a variable holding a function
    const fn = freeFunction;
    use(fn(4));

    // call through a property holding a function value
    const holder = { fn: freeFunction };
    use(holder.fn(5));

    // higher-order: a function passed and then invoked
    use(service.higherOrder(freeFunction));

    // callback forms: arrow, function expression, and a bare reference
    // (the last is the analogue of Java's `String::length`)
    use(rows.map((row) => row.score));
    use(rows.map(function (row) { return row.score; }));
    use(rows.map(scoreOf));

    // an immediately-invoked function expression, both spellings
    use((function () { return 1; })());
    use((() => 2)());

    // call with spread arguments
    const args: [number] = [6];
    use(freeFunction(...args));

    // .call / .apply / .bind: explicit receiver binding
    use(service.describe.call(service));
    use(service.describe.apply(service));
    const bound = service.describe.bind(service);
    use(bound());

    // optional call: invoked only if the callee is not null/undefined
    const maybeFn: ((value: number) => number) | undefined = freeFunction;
    use(maybeFn?.(7));
}

function scoreOf(row: Row): number {
    return row.score;
}

// --- construction forms --------------------------------------------------

export function constructionForms(): void {
    // plain construction
    use(new Service("a"));

    // construction with no argument list
    use(new Date());

    // construction of a generic type with explicit type arguments
    use(new Map<string, Row>());
    use(new Set<string>(["a"]));

    // construction of a derived class
    use(new Derived("b"));

    // construction through a qualified name (the ctor reached by a chain)
    use(new namespaces.models.Row("q"));

    // construction of a class expression
    const Local = class {
        readonly kind = "local";
    };
    use(new Local().kind);

    // construction held in a variable, then invoked
    const Ctor = Service;
    use(new Ctor("c"));

    // a chained method call directly on a `new` expression
    use(new Service("d").describe());

    // construction inside a call argument
    use(freeFunction(new Service("e").name.length));
}

// --- member access -------------------------------------------------------

export function memberAccess(row: Row, index: number, key: "id" | "score"): void {
    // dotted property access, and a nested chain
    use(row.id, row.child?.id);

    // element access with a literal, a variable, and an expression
    const tags = row.tags ?? [];
    use(tags[0], tags[index], tags[index + 1], tags[tags.length - 1]);

    // element access with a computed key
    use(row[key]);

    // element access on a call result
    use(String(row.id)[0]);

    // optional chaining in each of its three forms
    use(row.child?.score); // property
    use(row.tags?.[0]); // element
    const fn: ((value: number) => number) | undefined = freeFunction;
    use(fn?.(1)); // call

    // a long optional chain that short-circuits as a whole
    use(row.child?.child?.child?.tags?.[0]?.length);

    // optional chaining combined with nullish coalescing
    use(row.child?.score ?? 0);

    // non-null assertion inside a chain (erased)
    use(row.child!.id);
}

// --- #private access and the `#x in obj` brand check -------------------

export class Branded {
    #secret = 1;

    static isBranded(value: object): boolean {
        // the ergonomic brand check: an `in` test on a private name
        return #secret in value;
    }

    read(other: Branded): number {
        // a #private member is reachable on any instance of the same class
        return this.#secret + other.#secret;
    }
}

// --- new.target, only meaningful inside a constructor ----------------

export class TracksSubclassing {
    readonly viaSubclass: boolean;

    constructor() {
        this.viaSubclass = new.target !== TracksSubclassing;
    }
}
