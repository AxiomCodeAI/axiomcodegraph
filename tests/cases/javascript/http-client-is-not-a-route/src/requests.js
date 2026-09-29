import axios from 'axios';
import * as cfg from './cfg';

function buildConfig() { return {}; }
async function serialize(x) { return x; }
const opts = { headers: {} };

export function renderA(r) { return r; }
export function renderB(r) { return r; }
export function renderC(r) { return r; }
export function renderH(r) { return r; }
export function renderI(r) { return r; }

export function f1() { return axios.get('/api/f1', buildConfig()).then(renderA); }
export function f2() { return axios.get('/api/f2', opts).then(renderB); }
export function f3(x) { return axios.post('/api/f3', JSON.stringify(x)).then(renderC); }
export async function f8(x) { return axios.post('/api/f8', await serialize(x)).then(renderH); }
export function f9() { return axios.get('/api/f9', cfg.options).then(renderI); }
