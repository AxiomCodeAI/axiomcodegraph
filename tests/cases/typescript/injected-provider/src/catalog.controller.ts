import { Controller, Get, Param } from '@nestjs/common';
import { CatalogService, PriceTable } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get(':sku')
  findOne(@Param('sku') sku: string) {
    return this.catalog.lookup(sku);
  }
}

// The same constructor shape on a class no decorator marks: its caller is below.
export class Quote {
  constructor(private readonly prices: PriceTable) {}
  total(sku: string): number { return this.prices.priceOf(sku); }
}

export function quote(sku: string): number {
  return new Quote(new PriceTable()).total(sku);
}
