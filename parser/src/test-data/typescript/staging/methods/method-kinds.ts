// fixture: methods/method-kinds
// nature: runtime-bearing
// target: TypeScript 6.0.3 (static blocks 4.4, override 4.3, #private 3.8)
//
// Port of Java's `MethodKindsTest.java`: one declaration per method kind.
//
// Kinds Java has and TypeScript does not: `synchronized`, `native`, `strictfp`,
// and the instance initialiser block. Kinds TypeScript has and Java does not:
// getter, setter, async, generator, async generator, `#private` method,
// computed method name, well-known-symbol method, and the arrow-function class
// field (which is a property, not a method, and binds `this` differently).
//
// Shaped after real service/iterator code rather than invented names.

export interface Job {
    readonly id: string;
    readonly priority: number;
}

// the key of a computed method name, resolved at class-definition time
const describeMethodName = "describe";

export class JobQueue {
    private readonly jobs: Job[] = [];
    private static registryCount = 0;

    // --- constructor ------------------------------------------------------
    constructor(readonly name: string) {
        JobQueue.registryCount++;
    }

    // --- static initialisation block (ES2022) ----------------------------
    static {
        JobQueue.registryCount = 0;
    }

    // --- instance method --------------------------------------------------
    enqueue(job: Job): void {
        this.jobs.push(job);
    }

    // --- static method ----------------------------------------------------
    static create(name: string): JobQueue {
        return new JobQueue(name);
    }

    // --- private method (erased, compile-time visibility) ----------------
    private sortByPriority(): Job[] {
        return [...this.jobs].sort((a, b) => b.priority - a.priority);
    }

    // --- protected method -------------------------------------------------
    protected peek(): Job | undefined {
        return this.sortByPriority()[0];
    }

    // --- public method, modifier written explicitly ---------------------
    public size(): number {
        return this.jobs.length;
    }

    // --- #private method (a real runtime private name) -------------------
    #drainInto(target: Job[]): void {
        target.push(...this.jobs.splice(0));
    }

    drain(): Job[] {
        const out: Job[] = [];
        this.#drainInto(out);
        return out;
    }

    // --- getter and setter ------------------------------------------------
    get isEmpty(): boolean {
        return this.jobs.length === 0;
    }

    set capacity(value: number) {
        this.jobs.length = Math.min(this.jobs.length, value);
    }

    // --- static getter ----------------------------------------------------
    static get count(): number {
        return JobQueue.registryCount;
    }

    // --- async method -----------------------------------------------------
    async flush(): Promise<number> {
        const drained = this.drain();
        await Promise.resolve();
        return drained.length;
    }

    // --- generator method -------------------------------------------------
    *byPriority(): Generator<Job, void, undefined> {
        for (const job of this.sortByPriority()) {
            yield job;
        }
    }

    // --- async generator method -------------------------------------------
    async *stream(): AsyncGenerator<Job, void, undefined> {
        for (const job of this.jobs) {
            await Promise.resolve();
            yield job;
        }
    }

    // --- well-known symbol method: makes the class iterable --------------
    [Symbol.iterator](): Iterator<Job> {
        return this.jobs[Symbol.iterator]();
    }

    // --- computed method name from a module-level const ------------------
    [describeMethodName](): string {
        return this.name;
    }

    // --- optional method --------------------------------------------------
    onDrain?(count: number): void;

    // --- an arrow-function property: `this` is bound, not dynamic --------
    readonly handle = (job: Job): void => {
        this.enqueue(job);
    };
}

// --- abstract class: abstract, concrete, abstract accessor ---------------

export abstract class AbstractWorker {
    abstract process(job: Job): Promise<void>;

    abstract get concurrency(): number;

    protected abstract onError(error: Error): void;

    async run(queue: JobQueue): Promise<void> {
        for (const job of queue) {
            try {
                await this.process(job);
            } catch (error) {
                this.onError(error as Error);
            }
        }
    }
}

// --- subclass using `override` on each form ------------------------------

export class LoggingWorker extends AbstractWorker {
    readonly errors: Error[] = [];

    override async process(job: Job): Promise<void> {
        void job;
        await Promise.resolve();
    }

    override get concurrency(): number {
        return 1;
    }

    protected override onError(error: Error): void {
        this.errors.push(error);
    }
}

// --- top-level function forms --------------------------------------------

export function declaredFunction(job: Job): string {
    return job.id;
}

export async function asyncFunction(job: Job): Promise<string> {
    await Promise.resolve();
    return job.id;
}

export function* generatorFunction(jobs: readonly Job[]): Generator<string> {
    for (const job of jobs) {
        yield job.id;
    }
}

export async function* asyncGeneratorFunction(jobs: readonly Job[]): AsyncGenerator<string> {
    for (const job of jobs) {
        await Promise.resolve();
        yield job.id;
    }
}

export const functionExpression = function (job: Job): number {
    return job.priority;
};

export const namedFunctionExpression = function priorityOf(job: Job): number {
    return job.priority;
};

export const arrowFunction = (job: Job): string => job.id;

export const asyncArrowFunction = async (job: Job): Promise<string> => {
    await Promise.resolve();
    return job.id;
};

// --- methods in an object literal, including shorthand and accessors ----

export const jobUtils = {
    format(job: Job): string {
        return `${job.id}:${job.priority}`;
    },
    async load(id: string): Promise<Job> {
        await Promise.resolve();
        return { id, priority: 0 };
    },
    *ids(jobs: readonly Job[]): Generator<string> {
        for (const job of jobs) {
            yield job.id;
        }
    },
    get version(): string {
        return "1";
    },
    set version(value: string) {
        void value;
    },
    ["computed" + "Name"](): boolean {
        return true;
    },
};
