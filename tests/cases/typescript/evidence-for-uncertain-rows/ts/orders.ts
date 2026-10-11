export class OrderStore {
  get(id: string): string {
    return 'order:' + id;
  }
}
