export interface Matcher { exec(s: string): unknown }
export interface Text { find(m: RegExp): 1; }
export interface Plain { pick(m: RegExp): 1; }

export class Rx { exec(s: string): unknown { return s; } }
export class Bare { size(): number { return 0; } }
export interface Typed { take(m: Rx): 1; }
export interface Strict { hold(m: Bare): 1; }
