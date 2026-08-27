// fixture: integration/contracts (support module)
// nature: type-only
//
// The type-only half of the integration corpus: the contracts a layered
// application is written against. Consumed by service-layer.ts through
// `import type`, so none of it may reach the call graph.

export interface Entity {
    readonly id: string;
    readonly createdAt: number;
}

export interface User extends Entity {
    readonly email: string;
    readonly displayName: string;
    readonly role: "admin" | "editor" | "viewer";
}

export interface Order extends Entity {
    readonly userId: string;
    readonly total: number;
    readonly lines: readonly OrderLine[];
}

export interface OrderLine {
    readonly sku: string;
    readonly quantity: number;
    readonly unitPrice: number;
}

export interface Page<T> {
    readonly rows: readonly T[];
    readonly cursor: string | null;
}

export interface Query<T extends Entity> {
    readonly limit?: number;
    readonly cursor?: string | null;
    readonly where?: Partial<Record<keyof T, unknown>>;
}

export interface Repository<T extends Entity> {
    findById(id: string): Promise<T | undefined>;
    list(query: Query<T>): Promise<Page<T>>;
    save(entity: T): Promise<T>;
    delete(id: string): Promise<boolean>;
}

export interface UnitOfWork {
    readonly users: Repository<User>;
    readonly orders: Repository<Order>;
    commit(): Promise<void>;
}

export interface Logger {
    debug(message: string, context?: Record<string, unknown>): void;
    error(message: string, error: unknown): void;
}

export type Handler<TIn, TOut> = (input: TIn) => Promise<TOut>;
