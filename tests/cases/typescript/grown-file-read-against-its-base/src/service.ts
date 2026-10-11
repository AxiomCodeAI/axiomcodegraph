import { Clock, Gateway, Logger, Repo, Event, Report } from './repo';

export class Service {
  private readonly cache: Map<string, number>;

  private readonly label = 'service';

  constructor(
    private readonly repo: Repo,
    clock: Clock,
    logger: Logger,
    private readonly gateway: Gateway,
  ) {
    this.cache = new Map();
  }

  place(id: string): Promise<number> {
    return this.repo.run(async () => {
      const n = await this.repo.find(id);
      return this.authorize(n);
    });
  }

  async apply(event: Event): Promise<'applied' | 'ignored'> {
    const n = await this.repo.find(event.id);
    return n ? 'applied' : 'ignored';
  }

  private async authorize(n: number): Promise<number> {
    return this.gateway.pay(n);
  }

  get(id: string): number {
    return this.cache.get(id) ?? 0;
  }
}

export function reportFrom(event: Event): Report {
  const base = { id: event.id };
  return { ...base };
}
