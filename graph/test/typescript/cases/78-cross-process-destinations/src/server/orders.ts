// The server end, in the call form every router in this ecosystem shares:
// `app.<verb>(path, handler)`. The path is a literal, or a constant from another module.
import { ORDERS } from '../shared/paths';

declare const app: {
  get(path: string, h: unknown): void;
  post(path: string, h: unknown): void;
};
declare const router: {
  delete(path: string, h: unknown): void;
};

export function getOrder(): string { return 'one'; }
export function listOrders(): string { return 'all'; }
export function createOrder(): string { return 'created'; }
export function cancelWork(): string { return 'cancelled'; }
export function getInvoice(): string { return 'invoice'; }

// literal path with a route parameter
app.get('/api/orders/:id', getOrder);
// the same constant under two verbs: a POST must reach createOrder and never listOrders
app.get(ORDERS, listOrders);
app.post(ORDERS, createOrder);
app.get('/api/invoices/:id', getInvoice);
// an inline handler
router.delete('/api/orders/:id', () => cancelWork());
