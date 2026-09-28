import { ORDERS } from '../shared/paths';

declare const app: {
  get(path: string, h: unknown): void;
  post(path: string, h: unknown): void;
};

export function listOrders(): string {
  return 'all';
}

export function createOrder(): string {
  return 'created';
}

export function getOrder(): string {
  return 'one';
}

app.get(ORDERS, listOrders);
app.post(ORDERS, createOrder);
app.get('/api/orders/:id', getOrder);
