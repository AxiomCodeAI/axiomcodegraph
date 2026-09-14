// fixture: type-system/structural/implicit-implements
// nature: runtime-bearing
//
// THE case Java's model cannot express. In Java, a class implements an
// interface if and only if it SAYS SO; the `implements` clause is the
// authority. In TypeScript the clause is optional and non-authoritative: a
// class satisfies an interface whenever its members line up, and the checker
// never consults the clause to decide.
//
// ts-oracle measured 60.4% of classes in real TypeScript declaring no heritage
// clause at all. An extractor that derives "implements" edges from syntax
// therefore misses the majority of the relation.
//
// Every class below satisfies at least one interface WITHOUT naming it, and
// each is then used where that interface is required, so the satisfaction is
// load-bearing rather than incidental.

export interface Logger {
    log(message: string): void;
}

export interface Disposable {
    dispose(): void;
}

export interface Comparable<T> {
    compareTo(other: T): number;
}

export interface Repository<T> {
    find(id: string): T | undefined;
    save(entity: T): void;
}

export interface Row {
    readonly id: string;
}

// --- a class satisfying Logger, with NO implements clause -------------

export class ConsoleLogger {
    readonly lines: string[] = [];

    log(message: string): void {
        this.lines.push(message);
    }
}

// --- a class satisfying TWO interfaces, naming neither ---------------

export class FileHandle {
    private open = true;

    log(message: string): void {
        void message;
    }

    dispose(): void {
        this.open = false;
    }

    get isOpen(): boolean {
        return this.open;
    }
}

// --- a class satisfying a GENERIC interface without naming it -------

export class Version {
    constructor(
        readonly major: number,
        readonly minor: number,
    ) {}

    compareTo(other: Version): number {
        return this.major - other.major || this.minor - other.minor;
    }
}

// --- a class satisfying an interface it could not name: the interface
//     is declared AFTER it, and in no shared heritage ---------------

export class MemoryStore {
    private readonly rows = new Map<string, Row>();

    find(id: string): Row | undefined {
        return this.rows.get(id);
    }

    save(entity: Row): void {
        this.rows.set(entity.id, entity);
    }
}

// --- a class that DOES declare the clause, for contrast ------------

export class DeclaredLogger implements Logger {
    log(message: string): void {
        void message;
    }
}

// --- satisfaction with EXTRA members: still assignable -------------

export class RichLogger {
    log(message: string): void {
        void message;
    }

    warn(message: string): void {
        void message;
    }

    readonly level = "info";
}

// --- an object literal satisfying an interface, no class involved --

export const literalLogger = {
    log(message: string): void {
        void message;
    },
};

// --- an arrow-property class, satisfying via a property rather than
//     a method: a different member kind, same satisfaction ---------

export class ArrowLogger {
    readonly log = (message: string): void => {
        void message;
    };
}

// --- the load-bearing uses: each undeclared class flows into a
//     position typed by the interface it never named --------------

export function writeAll(logger: Logger, messages: readonly string[]): void {
    for (const message of messages) {
        logger.log(message);
    }
}

export function disposeAll(items: readonly Disposable[]): number {
    for (const item of items) {
        item.dispose();
    }
    return items.length;
}

export function maxOf<T extends Comparable<T>>(a: T, b: T): T {
    return a.compareTo(b) >= 0 ? a : b;
}

export function useRepository(repository: Repository<Row>, row: Row): Row | undefined {
    repository.save(row);
    return repository.find(row.id);
}

export function wire(): string {
    // assignment to an interface-typed binding
    const logger: Logger = new ConsoleLogger();
    const handle: Logger & Disposable = new FileHandle();
    const alsoLogger: Logger = literalLogger;
    const arrowed: Logger = new ArrowLogger();
    const rich: Logger = new RichLogger();

    // argument position
    writeAll(new ConsoleLogger(), ["a"]);
    writeAll(logger, ["b"]);
    disposeAll([new FileHandle()]);

    // generic instantiation inferred from an undeclared class
    const newest = maxOf(new Version(1, 2), new Version(1, 3));

    // an undeclared class satisfying a generic interface
    useRepository(new MemoryStore(), { id: "r1" });

    // array element and Map value positions
    const loggers: Logger[] = [new ConsoleLogger(), new FileHandle(), literalLogger, rich];
    const byName = new Map<string, Logger>([["console", new ConsoleLogger()]]);

    handle.dispose();
    alsoLogger.log("c");
    arrowed.log("d");

    return `${loggers.length}:${byName.size}:${newest.major}`;
}

// --- return-position satisfaction: the declared return type is the
//     interface, the returned value is an undeclared class --------

export function createLogger(kind: "console" | "file"): Logger {
    return kind === "console" ? new ConsoleLogger() : new FileHandle();
}

export function createRepository(): Repository<Row> {
    return new MemoryStore();
}
