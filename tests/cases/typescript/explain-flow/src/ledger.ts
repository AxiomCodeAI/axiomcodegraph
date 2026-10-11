// A question that names only TYPES: "how is the ledger Store chosen, how does CachedStore keep entries, where does
// the Journal get written". No entry point is a callable, so the flow has to start at the types' own methods.

export interface Store {
  load(key: string): Promise<string | undefined>;
  keep(key: string, value: string): Promise<void>;
}

export class MemoryStore implements Store {
  private readonly rows = new Map<string, string>();
  async load(key: string): Promise<string | undefined> {
    return this.rows.get(key);
  }
  async keep(key: string, value: string): Promise<void> {
    this.rows.set(key, value);
  }
}

export interface AuditJournal {
  append(line: string): void;
}

export class InMemoryAuditJournal implements AuditJournal {
  private readonly lines: string[] = [];
  append(line: string): void {
    this.lines.push(line);
  }
}

export class AuditJournalRelay {
  constructor(private readonly journal: AuditJournal) {}
  relay(lines: string[]): void {
    for (const line of lines) this.journal.append(line);
  }
}

export class CachedStore implements Store {
  private readonly hot = new Map<string, string>();
  constructor(private readonly inner: Store, private readonly journal: AuditJournal) {}
  async load(key: string): Promise<string | undefined> {
    const hit = this.hot.get(key);
    if (hit !== undefined) return hit;
    const value = await this.inner.load(key);
    if (value !== undefined) this.remember(key, value);
    return value;
  }
  async keep(key: string, value: string): Promise<void> {
    this.remember(key, value);
    this.journal.append(`keep ${key}`);
    await this.inner.keep(key, value);
  }
  private remember(key: string, value: string): void {
    this.hot.set(key, value);
  }
}

// Types with no method at all: a question naming only these has no flow anywhere, and the answer must say so and
// still list what it found.
export interface QuotaShape {
  readonly limit: number;
  readonly window: number;
}

export interface QuotaBudget {
  readonly shape: QuotaShape;
  readonly spent: number;
}
