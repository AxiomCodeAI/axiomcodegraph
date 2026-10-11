function shape<T>(fields: T): T { return fields; }

export const Settings = {
  retries: 3,
  timeoutMs: 1000,
};
export const LIMIT = { max: 1 };
export const Tokens = {
  Clock: 'Clock',
  Store: 'Store',
} as const;
export const OrderShape = shape({
  id: 'string',
  total: 'number',
});
export const api = {
  run(): number {
    return Settings.retries;
  },
};
export function total(): number {
  return Settings.timeoutMs - LIMIT.max;
}
