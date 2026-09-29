// The client end. None of these calls the server: the only thing tying a send to its
// handler is the route both ends spell, so every edge below is a remote_edge, never a call.
import axios from 'axios';
import { ORDERS } from '../shared/paths';
import { config } from '../shared/config';

// literal, built by a template: GET /api/orders/{} -> getOrder (a placeholder stood in for :id)
export async function fetchOrder(id: string) { return fetch(`/api/orders/${id}`); }

// constant: POST /api/orders -> createOrder, and NOT listOrders, which serves GET
export async function placeOrder(body: unknown) { return axios.post(ORDERS, body); }

// constant, GET by default: -> listOrders only
export async function listAll() { return fetch(ORDERS); }

// configured base address plus a segment: GET /api/reports/{} -> ReportsController.daily
export async function dailyReport(day: string) { return axios.get(`${config.reportsUrl}/${day}`); }

// verb from the init object, path by concatenation: DELETE /api/orders/{} -> the inline handler
export async function cancelOrder(id: string) { return fetch('/api/orders/' + id, { method: 'DELETE' }); }

// an instance with a base URL: GET /api/invoices/{} -> getInvoice
const billing = axios.create({ baseURL: 'http://billing:9000/api/invoices' });
export async function invoice(id: string) { return billing.get(`/${id}`); }

// served by nothing here: remote_unserved
export async function audit() { return axios.get('/api/audit'); }

// a destination that cannot be read: remote_undetermined
export async function anywhere(url: string) { return fetch(url); }

// CONTROL: a Map keyed by a path-shaped string is not a send
const cache = new Map<string, string>();
export function cached(): string | undefined { return cache.get('/api/orders'); }
