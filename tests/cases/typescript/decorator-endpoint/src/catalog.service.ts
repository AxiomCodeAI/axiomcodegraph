export class CatalogService {
  private items: string[] = [];
  lookup(sku: string): string | undefined {
    return this.items.find((i) => i === sku);
  }
  priceOf(sku: string): number {
    return this.lookup(sku) ? 10 : 0;
  }
}
