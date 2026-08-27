// fixture: type-system/typeof-subjects (support module)
// nature: runtime-bearing
//
// The VALUES that keyof-typeof-indexed.ts queries with the type-level `typeof`
// operator. They live here, separately, because a `typeof` query needs a real
// value to query and those values emit.
//
// Splitting them out is what lets the query file be honestly type-only: this
// file may produce call-graph rows, and that one may not.

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
