export class Store {
    tally(): number { return 1; }
    spare(): number { return 2; }
    counted(): number { return 3; }
}

export function use(s: any): number { return s.tally(); }

export function lonely(): number { return 1; }

export function onEvent(e: string): string { return e; }
