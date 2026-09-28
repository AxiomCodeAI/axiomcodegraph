import { Injectable } from '@nestjs/common';

@Injectable()
export class CatalogService {
  private items: string[] = [];
  lookup(sku: string): string | undefined {
    return this.items.find((i) => i === sku);
  }
}

// Handed to a constructor too, but only by code: nothing marks it as a provider.
export class PriceTable {
  priceOf(sku: string): number { return sku.length; }
}
