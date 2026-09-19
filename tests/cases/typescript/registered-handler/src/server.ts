import express from 'express';
import { listOrders, auditLog } from './orders';

const app = express();

app.get('/orders', listOrders);
setTimeout(auditLog, 1000);

export default app;
