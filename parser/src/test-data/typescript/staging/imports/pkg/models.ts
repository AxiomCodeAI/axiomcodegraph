// fixture: imports/pkg/models (support module)
// nature: type-only
//
// A module that exports ONLY types. Importing from it must never produce a
// runtime edge, and under `isolatedModules` a re-export of these names must
// use `export type`. See imports/pkg/index.ts.

export interface User {
    readonly id: string;
    readonly email: string;
    readonly roles: readonly string[];
}

export interface Session {
    readonly token: string;
    readonly userId: string;
    readonly expiresAt: number;
}

export type UserId = User["id"];

export type Role = "admin" | "editor" | "viewer";
