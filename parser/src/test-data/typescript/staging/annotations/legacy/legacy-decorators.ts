// fixture: annotations/legacy/legacy-decorators
// nature: runtime-bearing
// target: TypeScript 6.0.3 with experimentalDecorators + emitDecoratorMetadata
//         (compiled by annotations/legacy/tsconfig.json, NOT by the staging
//         root config -- the two decorator systems cannot share a project)
//
// The second, older decorator system, and the one the overwhelming majority
// of decorator-using TypeScript in the wild is written against: Angular,
// NestJS, TypeORM, class-validator, MobX and InversifyJS all ship legacy
// decorators. A parser that handles only standard decorators handles almost
// none of the real corpus.
//
// The two systems differ in ways a parser cannot paper over:
//   - legacy decorators receive (target, propertyKey, descriptor); standard
//     ones receive (value, context)
//   - PARAMETER decorators exist ONLY in the legacy system -- this is the
//     closest TypeScript gets to Java's parameter annotations, ported here
//     from `ParameterAnnotationTest.java`
//   - legacy decorators can be applied to constructor parameters, which is
//     how dependency injection is expressed in Angular and NestJS
//
// Shaped directly after those framework APIs.

export const registry: string[] = [];

// --- decorator declarations, in the legacy signature shapes -------------

export function Injectable(options: { providedIn?: string } = {}) {
    return function (target: Function): void {
        registry.push(`Injectable(${options.providedIn ?? "module"}) ${target.name}`);
    };
}

export function Controller(prefix: string) {
    return function (target: Function): void {
        registry.push(`Controller(${prefix}) ${target.name}`);
    };
}

export function Entity(options: { name: string; schema?: string }) {
    return function (target: Function): void {
        registry.push(`Entity(${options.name}/${options.schema ?? "public"}) ${target.name}`);
    };
}

export function Get(path = "/") {
    return function (
        target: object,
        propertyKey: string,
        descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
        registry.push(`Get(${path}) ${String(propertyKey)} ${typeof target}`);
        return descriptor;
    };
}

export function Column(options: { name?: string; nullable?: boolean; length?: number } = {}) {
    return function (target: object, propertyKey: string): void {
        registry.push(`Column(${options.name ?? String(propertyKey)}) ${typeof target}`);
    };
}

export function PrimaryGeneratedColumn(target: object, propertyKey: string): void {
    registry.push(`PrimaryGeneratedColumn ${String(propertyKey)} ${typeof target}`);
}

// a PARAMETER decorator -- no standard-decorator equivalent exists
export function Inject(token: string) {
    return function (target: object, propertyKey: string | symbol | undefined, index: number): void {
        registry.push(`Inject(${token}) ${String(propertyKey)}#${index} ${typeof target}`);
    };
}

export function Param(name: string) {
    return function (target: object, propertyKey: string | symbol | undefined, index: number): void {
        registry.push(`Param(${name}) ${String(propertyKey)}#${index}`);
        void target;
    };
}

export function Body(target: object, propertyKey: string | symbol | undefined, index: number): void {
    registry.push(`Body ${String(propertyKey)}#${index}`);
    void target;
}

// an accessor decorator
export function Memoized(
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
): PropertyDescriptor {
    registry.push(`Memoized ${String(propertyKey)} ${typeof target}`);
    return descriptor;
}

export const Nested = {
    Validate(options: { min?: number; max?: number } = {}) {
        return function (target: object, propertyKey: string): void {
            registry.push(`Validate(${options.min ?? 0}..${options.max ?? 0}) ${String(propertyKey)}`);
            void target;
        };
    },
};

// --- the TypeORM entity shape -------------------------------------------

@Entity({ name: "users", schema: "public" })
export class UserEntity {
    @PrimaryGeneratedColumn
    id!: number;

    @Column({ name: "email", nullable: false, length: 320 })
    email!: string;

    @Column()
    @Nested.Validate({ min: 1, max: 100 })
    displayName!: string;

    @Column({ nullable: true })
    deletedAt?: Date;

    static readonly table = "users";
}

// --- the Angular / NestJS injectable-service shape ----------------------

@Injectable({ providedIn: "root" })
export class UserRepository {
    private readonly rows = new Map<number, UserEntity>();

    constructor(@Inject("DATABASE_URL") private readonly url: string) {}

    find(id: number): UserEntity | undefined {
        void this.url;
        return this.rows.get(id);
    }

    save(entity: UserEntity): void {
        this.rows.set(entity.id, entity);
    }
}

// --- the NestJS controller shape: class, method AND parameter decorators -

@Controller("users")
export class UserController {
    // constructor-parameter decorators alongside parameter properties
    constructor(
        private readonly repository: UserRepository,
        @Inject("LOGGER") private readonly logger: { log(message: string): void },
    ) {}

    @Get(":id")
    findOne(@Param("id") id: string): UserEntity | undefined {
        this.logger.log(`findOne ${id}`);
        return this.repository.find(Number(id));
    }

    @Get()
    @Memoized
    findAll(@Body body: unknown, @Param("limit") limit?: string): readonly UserEntity[] {
        void body;
        void limit;
        return [];
    }

    @Memoized
    get cacheKey(): string {
        return "users";
    }

    @Get("static")
    static health(): string {
        return "ok";
    }
}
