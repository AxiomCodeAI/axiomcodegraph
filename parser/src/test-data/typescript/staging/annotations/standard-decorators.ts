// fixture: annotations/standard-decorators
// nature: runtime-bearing
// target: TypeScript 6.0.3 (standard/TC39 decorators, since 5.0; no
//         experimentalDecorators -- this file compiles under the repo's
//         default compiler options)
//
// The TypeScript port of Java's `annotations` category. A Java annotation is
// metadata read reflectively; a standard decorator is a FUNCTION CALLED AT
// CLASS-DEFINITION TIME that can replace what it decorates. That is the
// difference the parser has to carry: a decorator is runtime-bearing and each
// decoration is a call site, whereas a Java annotation is inert.
//
// Every decorator target the standard proposal defines is exercised: class,
// method, getter, setter, field, auto-accessor, and their static and #private
// variants, plus addInitializer.
//
// Shaped after the decorators people actually write -- @logged, @bound,
// @memoize, @deprecated.

type Ctor = abstract new (...args: any[]) => unknown;

// --- decorator DECLARATIONS: the analogue of Java's `@interface` ---------
//     (the type of each context object is what identifies the target kind)

export function logged<T extends (this: any, ...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
): T {
    const name = String(context.name);
    return function (this: unknown, ...args: unknown[]) {
        trace.push(`enter ${name}`);
        const result = target.apply(this, args);
        trace.push(`exit ${name}`);
        return result;
    } as T;
}

export function bound<T extends (this: any, ...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
): void {
    context.addInitializer(function (this: any) {
        this[context.name] = target.bind(this);
    });
}

export function deprecated(message: string) {
    return function <T extends Ctor>(target: T, context: ClassDecoratorContext): T {
        trace.push(`deprecated ${String(context.name)}: ${message}`);
        return target;
    };
}

export function memoize<T extends (this: any, ...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
): T {
    const cache = new Map<string, unknown>();
    void context;
    return function (this: unknown, ...args: unknown[]) {
        const key = JSON.stringify(args);
        if (!cache.has(key)) {
            cache.set(key, target.apply(this, args));
        }
        return cache.get(key);
    } as T;
}

export function readonlyField<This, T>(
    _target: undefined,
    context: ClassFieldDecoratorContext<This, T>,
): (this: This, initial: T) => T {
    return function (this: This, initial: T): T {
        trace.push(`init ${String(context.name)}`);
        return initial;
    };
}

export function clamped(min: number, max: number) {
    return function <This>(
        target: ClassAccessorDecoratorTarget<This, number>,
        context: ClassAccessorDecoratorContext<This, number>,
    ): ClassAccessorDecoratorResult<This, number> {
        void context;
        return {
            get(this: This) {
                return target.get.call(this);
            },
            set(this: This, value: number) {
                target.set.call(this, Math.min(Math.max(value, min), max));
            },
        };
    };
}

export function traced<This, T>(
    target: (this: This) => T,
    context: ClassGetterDecoratorContext<This, T>,
): (this: This) => T {
    return function (this: This): T {
        trace.push(`get ${String(context.name)}`);
        return target.call(this);
    };
}

export function validated<This, T>(
    target: (this: This, value: T) => void,
    context: ClassSetterDecoratorContext<This, T>,
): (this: This, value: T) => void {
    return function (this: This, value: T): void {
        trace.push(`set ${String(context.name)}`);
        target.call(this, value);
    };
}

export const trace: string[] = [];

// --- a bare (unparenthesised) class decorator ---------------------------

function sealedShape<T extends Ctor>(target: T, context: ClassDecoratorContext): T {
    void context;
    Object.freeze(target);
    return target;
}

// --- the decorated class -------------------------------------------------

@sealedShape
@deprecated("use PricingService instead")
export class LegacyPricing {
    // decorated field
    @readonlyField
    currency = "GBP";

    // decorated static field
    @readonlyField
    static version = 1;

    // auto-accessor, decorated (an `accessor` field is a getter/setter pair
    // over a private slot -- syntax that has no Java counterpart)
    @clamped(0, 100)
    accessor discountPercent = 0;

    // plain auto-accessor
    accessor label = "legacy";

    // decorated method
    @logged
    price(base: number): number {
        return base * (1 - this.discountPercent / 100);
    }

    // stacked decorators, applied bottom-up
    @logged
    @memoize
    expensive(seed: number): number {
        return seed ** 2;
    }

    // decorated method, bound to the instance by its decorator
    @bound
    describe(): string {
        return `${this.currency}/${this.label}`;
    }

    // decorated static method
    @logged
    static reset(): void {
        LegacyPricing.version = 1;
    }

    // decorated getter and setter
    @traced
    get summary(): string {
        return `${this.label}:${this.discountPercent}`;
    }

    @validated
    set summary(value: string) {
        this.label = value;
    }

    // decorated #private method
    @logged
    #audit(): string {
        return this.label;
    }

    audit(): string {
        return this.#audit();
    }
}

// --- a decorated class EXPRESSION ---------------------------------------

export const AnonymousPricing = @sealedShape class {
    readonly kind = "anonymous";
};

// --- a decorated default-exported class ---------------------------------

@deprecated("internal")
class InternalPricing extends LegacyPricing {}

export default InternalPricing;
