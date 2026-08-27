// fixture: type-registry/type-modifiers-and-access
// nature: runtime-bearing
// target: TypeScript 6.0.3 (#private since 3.8, override since 4.3, static blocks since 4.4)
//
// Modifier and visibility surface of a declared type. TypeScript has two
// independent visibility systems and this fixture exercises both:
//   1. module visibility  -- exported vs. not exported (the analogue of Java's
//      public vs. package-private *type*)
//   2. member visibility  -- public / protected / private (erased, compile-time
//      only) and #private (a real runtime private name)
//
// Java's `final`, `sealed`/`permits`, `synchronized`, `native`, `transient` and
// `volatile` have no TypeScript analogue; see MANIFEST.md.
//
// Shapes are modelled on the singleton/registry pattern as it appears in real
// service code and on TypeScript's own DocumentRegistry.

// --- module visibility: exported ------------------------------------------

export class ExportedService {}

// --- module visibility: declared but not exported (module-local) ----------

class ModuleLocalCache {
    private readonly entries = new Map<string, string>();

    set(key: string, value: string): void {
        this.entries.set(key, value);
    }

    get(key: string): string | undefined {
        return this.entries.get(key);
    }
}

// --- abstract, and abstract members ---------------------------------------

export abstract class AbstractDocumentRegistry {
    protected abstract readonly bucketKey: string;

    abstract acquireDocument(fileName: string): string;

    abstract get size(): number;

    releaseDocument(fileName: string): void {
        void fileName;
    }
}

// --- every member modifier, including the interactions ---------------------

export class DocumentRegistry extends AbstractDocumentRegistry {
    // static
    static readonly defaultBucket = "default";

    // static, private
    private static instanceCount = 0;

    // ECMAScript private name: a genuine runtime private, not an erased one
    readonly #documents = new Map<string, string>();

    // #private method
    #normalize(fileName: string): string {
        return fileName.replace(/\\/g, "/");
    }

    // public (explicit) instance field with an initialiser
    public useCaseSensitiveFileNames = false;

    // protected, satisfying the abstract member above
    protected override readonly bucketKey: string;

    // private, readonly, definite-assignment not needed (assigned in ctor)
    private readonly createdAt: Date;

    // optional member
    onRelease?: (fileName: string) => void;

    // static initialization block (ES2022)
    static {
        DocumentRegistry.instanceCount = 0;
    }

    // private constructor: the closest TypeScript comes to a sealed hierarchy
    private constructor(bucketKey: string) {
        super();
        this.bucketKey = bucketKey;
        this.createdAt = new Date();
        DocumentRegistry.instanceCount++;
    }

    static create(bucketKey = DocumentRegistry.defaultBucket): DocumentRegistry {
        return new DocumentRegistry(bucketKey);
    }

    static get count(): number {
        return DocumentRegistry.instanceCount;
    }

    override acquireDocument(fileName: string): string {
        const key = this.#normalize(fileName);
        const existing = this.#documents.get(key);
        if (existing !== undefined) {
            return existing;
        }
        this.#documents.set(key, "");
        return "";
    }

    override get size(): number {
        return this.#documents.size;
    }

    // getter and setter pair on one property name
    get age(): number {
        return Date.now() - this.createdAt.getTime();
    }

    set caseSensitivity(value: boolean) {
        this.useCaseSensitiveFileNames = value;
    }
}

// --- parameter properties: the DI-constructor idiom (Angular, NestJS) ------

export class UserService {
    constructor(
        private readonly registry: DocumentRegistry,
        protected cache: ModuleLocalCache,
        public label: string,
        readonly retries = 3,
    ) {}

    describe(): string {
        return `${this.label}/${this.retries}/${this.registry.size}/${this.cache.get("x") ?? ""}`;
    }
}

// --- readonly interface members and a readonly index signature ------------

export interface FrozenConfig {
    readonly rootDir: string;
    readonly strict: boolean;
    readonly [option: string]: string | boolean | undefined;
}

export const exportedRegistry = DocumentRegistry.create();
