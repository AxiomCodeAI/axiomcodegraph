'use strict';
// Drives every route, the param handler, the error paths, events and the async handler,
// then exits. This is the "test suite" the runtime oracle records.
const http = require('http');
const { start } = require('./server');
function call(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, method, path, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      (res) => { let buf = ''; res.on('data', (c) => { buf += c; }); res.on('end', () => resolve({ status: res.statusCode, body: buf })); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
async function main() {
  const server = start(0, () => {});
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  const r = [];
  r.push(await call(port, 'GET', '/api/health'));
  r.push(await call(port, 'POST', '/api/todos', { title: 'a' }));
  r.push(await call(port, 'POST', '/api/todos', { title: '  ' }));
  r.push(await call(port, 'GET', '/api/todos'));
  r.push(await call(port, 'GET', '/api/todos?filter=open'));
  r.push(await call(port, 'GET', '/api/todos/1'));
  r.push(await call(port, 'GET', '/api/todos/9'));
  r.push(await call(port, 'GET', '/api/todos/x'));
  r.push(await call(port, 'POST', '/api/todos/1/toggle'));
  r.push(await call(port, 'DELETE', '/api/todos/1'));
  r.push(await call(port, 'GET', '/api/audit'));
  r.push(await call(port, 'GET', '/nope'));
  server.close();
  const statuses = r.map((x) => x.status).join(',');
  if (statuses !== '200,201,400,200,200,200,404,400,200,204,200,404') throw new Error('unexpected statuses ' + statuses);
  console.log('ok', statuses);
}
main().catch((e) => { console.error(e); process.exit(1); });
