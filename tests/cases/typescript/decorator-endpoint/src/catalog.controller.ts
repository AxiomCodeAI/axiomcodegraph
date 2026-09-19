import { Controller, Get, Param } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get(':sku')
  findOne(@Param('sku') sku: string) {
    return this.catalog.lookup(sku);
  }

  @Get(':sku/price')
  priceOf(@Param('sku') sku: string) {
    return this.catalog.priceOf(sku);
  }
}
