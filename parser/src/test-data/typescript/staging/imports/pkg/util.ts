// fixture: imports/pkg/util (support module)
// nature: runtime-bearing
//
// A module with runtime exports in several shapes: named function, named
// const, a default export, and a re-exported binding. Consumed by
// imports/import-forms.ts.

import type { Role, User } from "./models";

export const DEFAULT_ROLE: Role = "viewer";

export function hasRole(user: User, role: Role): boolean {
    return user.roles.includes(role);
}

export function formatUser(user: User): string {
    return `${user.email} <${user.id}>`;
}

export class Clock {
    now(): number {
        return Date.now();
    }
}

// a default export sitting alongside named ones
export default function createId(seed: number): string {
    return `u-${seed.toString(36)}`;
}
