export const LIMIT = 10;
export const CFG = { name: 'a', port: 1 } as const;
export const SCHEMA = shape({ id: 'string' });

export function shape(o: object): object { return o; }
