// run.js <hook>.py — run one hook under the Python find-python.js finds (#1331).
//
// hooks.json used to say `python3 <hook>.py`, and on Windows `python3` is the Store placeholder or nothing,
// so every hook failed on every tool call. The command is now `node run.js <hook>.py`: node is the same name
// on every platform, and the MCP server already needs it (#1233).
//
// The event arrives on stdin and is passed on whole; stdout, stderr and the exit status come back unchanged,
// because exit 2 is how a hook blocks. A hook must never block a tool for want of an interpreter, so with no
// Python the runner exits 0 and says why on stderr, which the host shows only in its debug output.
//
// The environment it passes carries the python3 bash needs and the bash find-bash.js chose, for the
// background refresh a hook starts: that runs axiomcode-build, a bash script that calls python3.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findPython, withPython } = require('../mcp/find-python.js');
const { findBash } = require('../mcp/find-bash.js');

const hook = process.argv[2];
if (!hook) { process.stderr.write('usage: node run.js <hook>.py\n'); process.exit(0); }

const py = findPython();
if (!py.exe) { process.stderr.write(`axiomcode hook ${hook}: ${py.error}\n`); process.exit(0); }

let input = '';
try { input = fs.readFileSync(0); } catch { /* no stdin: the hook reads an empty event */ }

const env = withPython(process.env, py);
const { bash } = findBash();
if (bash) env.AXIOMCODE_BASH = bash;

const r = spawnSync(py.exe, [path.join(__dirname, hook)], { input, env, windowsHide: true,
                                                              stdio: ['pipe', 'inherit', 'inherit'] });
if (r.error) { process.stderr.write(`axiomcode hook ${hook}: could not start ${py.exe}: ${r.error.message}\n`); process.exit(0); }
process.exit(r.status ?? 0);
