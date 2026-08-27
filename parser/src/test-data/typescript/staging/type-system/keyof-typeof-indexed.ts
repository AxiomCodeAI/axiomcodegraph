// fixture: type-system/keyof-typeof-indexed
// nature: type-only
//
// The three query operators that cross between the value world and the type
// world: `keyof` (a type's keys as a union), `typeof` (a VALUE's type, in type
// position), and indexed access `T[K]`.
//
// `typeof` here is the type-level operator, not the runtime one in
// expressions/operators.ts. The two share a keyword and share nothing else --
// a parser that treats them alike will emit runtime edges for type queries.

export interface User {
    readonly id: string;
    readonly email: string;
    readonly age: number;
    readonly tags: readonly string[];
    readonly address: { readonly city: string; readonly postcode: string };
    greet(other: string): string;
}

// --- keyof ---------------------------------------------------------------

export type UserKeys = keyof User;
export type ArrayKeys = keyof readonly string[];
export type StringIndexKeys = keyof { [key: string]: number };
export type NumberIndexKeys = keyof { [index: number]: string };
export type UnionKeys = keyof (User | { readonly id: string });
export type IntersectionKeys = keyof (User & { readonly extra: boolean });
export type NeverKeys = keyof unknown;
export type StringOnlyKeys = Extract<keyof User, string>;

// --- typeof, applied to values ------------------------------------------

export const defaultUser = {
    id: "u1",
    email: "a@example.com",
    age: 30,
    roles: ["admin", "viewer"],
    nested: { enabled: true },
};

export const routes = ["/users", "/orders", "/health"] as const;

export function makeUser(id: string): { readonly id: string; readonly createdAt: number } {
    return { id, createdAt: 0 };
}

export class Service {
    readonly name = "svc";
    run(): number {
        return 1;
    }
    static create(): Service {
        return new Service();
    }
}

export enum Status {
    Active = "active",
    Archived = "archived",
}

export type DefaultUser = typeof defaultUser;
export type Routes = typeof routes;
export type RouteName = (typeof routes)[number];
export type MakeUser = typeof makeUser;
export type MadeUser = ReturnType<typeof makeUser>;
export type ServiceInstance = InstanceType<typeof Service>;
export type ServiceStatics = typeof Service;
export type StatusKeys = keyof typeof Status;
export type StatusValues = (typeof Status)[keyof typeof Status];
export type NestedValueType = (typeof defaultUser)["nested"]["enabled"];

// --- indexed access ------------------------------------------------------

export type UserId = User["id"];
export type UserIdOrAge = User["id" | "age"];
export type AllUserValues = User[keyof User];
export type Tag = User["tags"][number];
export type City = User["address"]["city"];
export type GreetSignature = User["greet"];
export type GreetReturn = ReturnType<User["greet"]>;
export type TupleFirst = (readonly [string, number])[0];
export type TupleMembers = (readonly [string, number])[number];
export type ArrayElement = (readonly string[])[number];

// --- the three combined, which is where they are actually used ---------

export type ValueOf<T> = T[keyof T];
export type Pluck<T, K extends keyof T> = T[K];
export type PickPaths<T> = { [K in keyof T]: T[K] };

export function getProperty<T, K extends keyof T>(source: T, key: K): T[K] {
    return source[key];
}

export function setProperty<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
    target[key] = value;
}

export type UserValue = ValueOf<User>;
export type PluckedEmail = Pluck<User, "email">;
export type RoleElement = (typeof defaultUser)["roles"][number];
