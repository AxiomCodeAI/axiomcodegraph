'use strict';
const __axiom = require("./__axiom_runtime.js"); const __p = __axiom.enter("exercise.js:1:1");
// Drives every route, the param handler, the error paths, events and the async handler,
// then exits. This is the "test suite" the runtime oracle records.
const http = require('http');
const { start } = require('./server');
function call(port, method, path, body) {
    return __axiom.run("exercise.js:6:1", () => {
        return new Promise((resolve, reject) => {
            return __axiom.run("exercise.js:7:22", () => {
                const data = body ? JSON.stringify(body) : null;
                const req = http.request({ port, method, path, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
                    return __axiom.run("exercise.js:10:7", () => {
                        let buf = '';
                        res.on('data', (c) => {
                            return __axiom.run("exercise.js:10:47", () => {
                                buf += c;
                            });
                        });
                        res.on('end', () => {
                            return __axiom.run("exercise.js:10:84", () => {
                                return resolve({ status: res.statusCode, body: buf });
                            });
                        });
                    });
                });
                req.on('error', reject);
                if (data)
                    req.write(data);
                req.end();
            });
        });
    });
}
async function main() {
    return __axiom.run("exercise.js:14:1", async () => {
        const server = start(0, () => {
            return __axiom.run("exercise.js:15:27", () => {
            });
        });
        await new Promise((r) => {
            return __axiom.run("exercise.js:16:21", () => {
                return server.on('listening', r);
            });
        });
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
        const statuses = r.map((x) => {
            return __axiom.run("exercise.js:32:26", () => {
                return x.status;
            });
        }).join(',');
        if (statuses !== '200,201,400,200,200,200,404,400,200,204,200,404')
            throw new Error('unexpected statuses ' + statuses);
        console.log('ok', statuses);
    });
}
main().catch((e) => {
    return __axiom.run("exercise.js:36:14", () => {
        console.error(e);
        process.exit(1);
    });
});

__axiom.exit(__p);
