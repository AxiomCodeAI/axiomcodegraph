import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class StockRepo {
  count(sku: string): number { return sku.length; }
}

// Wired by a TOKEN the decorator names, not by the declared type: StockRepo is only
// the static type here, so this slot must not read as "receives StockRepo".
@Injectable()
export class StockService {
  constructor(@InjectRepository(Object) private readonly repo: StockRepo) {}
  inStock(sku: string): boolean { return this.repo.count(sku) > 0; }
}
