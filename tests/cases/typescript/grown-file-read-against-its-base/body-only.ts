import { Clock, Repo } from './repo';

export class Service {
  private readonly cache: Map<string, number>;

  constructor(
    private readonly repo: Repo,
    clock: Clock,
  ) {
    this.cache = new Map([["", 0]]);
  }

  place(id: string): Promise<number> {
    return this.repo.run(async () => {
      const n = await this.repo.find(id);
      return n;
    });
  }

  get(id: string): number {
    return this.cache.get(id) ?? 0;
  }
}
