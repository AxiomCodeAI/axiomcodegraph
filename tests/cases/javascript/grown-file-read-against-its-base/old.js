export class Service {
  constructor(
    repo,
    clock,
  ) {
    this.repo = repo;
  }

  get(id) {
    return this.repo.run(async () => {
      return this.repo.find(id);
    });
  }
}
