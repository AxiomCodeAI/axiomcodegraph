import axios from 'axios';
import { ORDERS } from '../shared/paths';

// POST /api/orders: reaches createOrder across the process, and never listOrders (GET)
export async function placeOrder(body: unknown) { return axios.post(ORDERS, body); }

// GET /api/orders/{}: reaches getOrder
export async function fetchOrder(id: string) { return fetch(`/api/orders/${id}`); }
