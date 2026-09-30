export class Service {
  constructor(
    repo,
    clock,
    gateway,
  ) {
    this.repo = repo;
    this.gateway = gateway;
  }

  get(id) {
    return this.repo.run(async () => {
      return this.pay(this.repo.find(id));
    });
  }

  async pay(n) {
    const total = n;
    return this.gateway.pay(total);
  }
}

export async function report(event) {
  const base = { id: event.id };
  return base;
}
