// fixture: integration/service-layer
// nature: runtime-bearing
//
// Port of Java's `CompleteExample.java`, `ComplexMethodsIntegration.java` and
// `test-multiple-types.java`: one realistic module in which every construct
// the other categories isolate appears together, in the proportions real code
// uses them.
//
// A layered application: domain errors, a generic in-memory repository, a
// unit of work, a service with dependency-injected collaborators, a decorated
// controller-ish facade, and an event emitter. Shaped after the repository /
// service / controller layering that dominates real TypeScript backends.
//
// What makes this an INTEGRATION fixture rather than a bigger unit one:
//   - it crosses a module boundary for its types (`import type`) and for a
//     runtime value (`import`), so both edge kinds appear in one file
//   - generic classes implement generic interfaces declared elsewhere
//   - overload signatures, async methods, generators and decorators coexist
//   - inheritance, composition and closures all appear in the same call paths

import type {
    Entity,
    Handler,
    Logger,
    Order,
    OrderLine,
    Page,
    Query,
    Repository,
    UnitOfWork,
    User,
} from "./contracts";
import { Priority } from "../local-variables/helper-types";

// --- domain errors --------------------------------------------------------

export class DomainError extends Error {
    override readonly name: string = "DomainError";

    constructor(
        message: string,
        readonly code: string,
    ) {
        super(message);
    }
}

export class NotFoundError extends DomainError {
    override readonly name = "NotFoundError";

    constructor(readonly entityId: string) {
        super(`entity ${entityId} not found`, "NOT_FOUND");
    }
}

export class ValidationFailed extends DomainError {
    override readonly name = "ValidationFailed";

    constructor(readonly issues: readonly string[]) {
        super(issues.join("; "), "VALIDATION");
    }
}

// --- an enum used across the layers -------------------------------------

export enum OrderStatus {
    Draft = "draft",
    Submitted = "submitted",
    Fulfilled = "fulfilled",
    Cancelled = "cancelled",
}

// --- a generic in-memory repository implementing an imported interface --

export class InMemoryRepository<T extends Entity> implements Repository<T> {
    protected readonly rows = new Map<string, T>();

    constructor(protected readonly logger: Logger) {}

    async findById(id: string): Promise<T | undefined> {
        this.logger.debug("findById", { id });
        await Promise.resolve();
        return this.rows.get(id);
    }

    async list(query: Query<T>): Promise<Page<T>> {
        await Promise.resolve();
        const all = [...this.rows.values()];
        const limit = query.limit ?? 20;
        const filtered = query.where === undefined ? all : all.filter((row) => matches(row, query.where));
        const rows = filtered.slice(0, limit);
        return { rows, cursor: filtered.length > limit ? String(limit) : null };
    }

    async save(entity: T): Promise<T> {
        this.rows.set(entity.id, entity);
        await Promise.resolve();
        return entity;
    }

    async delete(id: string): Promise<boolean> {
        await Promise.resolve();
        return this.rows.delete(id);
    }

    protected count(): number {
        return this.rows.size;
    }
}

function matches<T extends Entity>(row: T, where: Partial<Record<keyof T, unknown>> | undefined): boolean {
    if (where === undefined) {
        return true;
    }
    for (const [key, expected] of Object.entries(where)) {
        if (row[key as keyof T] !== expected) {
            return false;
        }
    }
    return true;
}

// --- a repository subclass adding domain-specific queries ---------------

export class OrderRepository extends InMemoryRepository<Order> {
    async findByUser(userId: string): Promise<readonly Order[]> {
        const page = await this.list({ limit: 100 });
        return page.rows.filter((order) => order.userId === userId);
    }

    // a generator over repository contents
    *drafts(): Generator<Order> {
        for (const order of this.rows.values()) {
            if (order.total === 0) {
                yield order;
            }
        }
    }

    override async delete(id: string): Promise<boolean> {
        this.logger.debug("deleting order", { id, remaining: this.count() });
        return super.delete(id);
    }
}

// --- the unit of work, composing two repositories ----------------------

export class InMemoryUnitOfWork implements UnitOfWork {
    readonly users: Repository<User>;
    readonly orders: OrderRepository;

    constructor(private readonly logger: Logger) {
        this.users = new InMemoryRepository<User>(logger);
        this.orders = new OrderRepository(logger);
    }

    async commit(): Promise<void> {
        this.logger.debug("commit");
        await Promise.resolve();
    }
}

// --- a small event emitter, exercising closures and callbacks ----------

type Listener<T> = (payload: T) => void;

export class Emitter<TEvents extends Record<string, unknown>> {
    private readonly listeners = new Map<keyof TEvents, Array<Listener<never>>>();

    on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
        const bucket = this.listeners.get(event) ?? [];
        bucket.push(listener as Listener<never>);
        this.listeners.set(event, bucket);
        // the returned closure captures both `bucket` and `listener`
        return () => {
            const index = bucket.indexOf(listener as Listener<never>);
            if (index >= 0) {
                bucket.splice(index, 1);
            }
        };
    }

    emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): number {
        const bucket = this.listeners.get(event) ?? [];
        for (const listener of bucket) {
            (listener as Listener<TEvents[K]>)(payload);
        }
        return bucket.length;
    }
}

// declared as a type alias, not an interface, deliberately: an interface has
// no implicit index signature and so does not satisfy `Record<string, unknown>`,
// while a type alias does. This is a real and frequently-hit asymmetry.
export type OrderEvents = {
    submitted: { readonly orderId: string; readonly total: number };
    cancelled: { readonly orderId: string; readonly reason: string };
};

// --- a standard decorator applied in the service layer ----------------

function audited<T extends (this: any, ...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
): T {
    const name = String(context.name);
    return function (this: { readonly audit: string[] }, ...args: unknown[]) {
        this.audit.push(name);
        return target.apply(this, args);
    } as T;
}

// --- the service: DI constructor, overloads, async, decorators --------

export class OrderService {
    readonly audit: string[] = [];
    private readonly events = new Emitter<OrderEvents>();

    constructor(
        private readonly work: UnitOfWork,
        private readonly logger: Logger,
        private readonly priority: Priority = Priority.Normal,
    ) {}

    // overload signatures plus one implementation
    async place(userId: string, lines: readonly OrderLine[]): Promise<Order>;
    async place(userId: string, lines: readonly OrderLine[], idempotencyKey: string): Promise<Order>;
    @audited
    async place(
        userId: string,
        lines: readonly OrderLine[],
        idempotencyKey?: string,
    ): Promise<Order> {
        const issues = this.validate(lines);
        if (issues.length > 0) {
            throw new ValidationFailed(issues);
        }

        const user = await this.work.users.findById(userId);
        if (user === undefined) {
            throw new NotFoundError(userId);
        }

        const order: Order = {
            id: idempotencyKey ?? `o-${Date.now()}`,
            createdAt: Date.now(),
            userId,
            total: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
            lines,
        };

        try {
            const saved = await this.work.orders.save(order);
            await this.work.commit();
            this.events.emit("submitted", { orderId: saved.id, total: saved.total });
            return saved;
        } catch (error) {
            this.logger.error("place failed", error);
            throw error instanceof DomainError
                ? error
                : new DomainError("could not place order", "UNKNOWN");
        }
    }

    @audited
    async cancel(orderId: string, reason: string): Promise<OrderStatus> {
        const removed = await this.work.orders.delete(orderId);
        if (!removed) {
            throw new NotFoundError(orderId);
        }
        this.events.emit("cancelled", { orderId, reason });
        return OrderStatus.Cancelled;
    }

    private validate(lines: readonly OrderLine[]): readonly string[] {
        const issues: string[] = [];
        if (lines.length === 0) {
            issues.push("an order needs at least one line");
        }
        for (const line of lines) {
            if (line.quantity <= 0) {
                issues.push(`line ${line.sku} has a non-positive quantity`);
            }
            if (line.unitPrice < 0) {
                issues.push(`line ${line.sku} has a negative price`);
            }
        }
        return issues;
    }

    // a generic method taking a handler imported as a type
    async pipe<TIn, TOut>(input: TIn, handler: Handler<TIn, TOut>): Promise<TOut> {
        this.logger.debug("pipe", { priority: this.priority });
        return handler(input);
    }

    onSubmitted(listener: (payload: OrderEvents["submitted"]) => void): () => void {
        return this.events.on("submitted", listener);
    }

    // async generator streaming pages out of the repository
    async *stream(pageSize: number): AsyncGenerator<readonly Order[]> {
        let cursor: string | null = null;
        do {
            const page: Page<Order> = await this.work.orders.list({ limit: pageSize, cursor });
            cursor = page.cursor;
            yield page.rows;
        } while (cursor !== null);
    }
}

// --- a composition root wiring the layers together --------------------

export function createOrderService(logger: Logger): OrderService {
    const work = new InMemoryUnitOfWork(logger);
    return new OrderService(work, logger, Priority.High);
}
