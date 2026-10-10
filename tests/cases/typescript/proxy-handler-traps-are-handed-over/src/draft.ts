export function readThrough(target: Record<string, unknown>, key: string): unknown {
  return target[key];
}

export function writeThrough(target: Record<string, unknown>, key: string, value: unknown): boolean {
  target[key] = value;
  return true;
}

const traps: ProxyHandler<Record<string, unknown>> = {
  get(target, key) {
    return readThrough(target, String(key));
  },
  set(target, key, value) {
    return writeThrough(target, String(key), value);
  },
};

export function createDraft(base: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(base, traps);
}

export function wrapWith(base: object, handler: ProxyHandler<object>): object {
  return Proxy.revocable(base, handler).proxy;
}

export function auditValue(key: string): string {
  return key.toUpperCase();
}

const auditTraps: ProxyHandler<object> = {
  get(_target, key) {
    return auditValue(String(key));
  },
};

export function createAudited(base: object): object {
  return wrapWith(base, auditTraps);
}

export function computeEntry(key: string): number {
  return key.length;
}

const lookupTable = {
  get(key: string): number {
    return computeEntry(key);
  },
};

export function frozenTable(): object {
  return Object.freeze(lookupTable);
}
