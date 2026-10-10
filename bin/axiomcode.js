#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// The installed `axiomcode` command. It only finds a bash and hands everything to
// bin/axiomcode, which is the CLI.
//
// WHY A NODE LAUNCHER (#1229). npm writes the command's wrappers itself from the `bin` entry: a
// symlink on POSIX, and on Windows an axiomcode.cmd and an axiomcode.ps1 that run whatever the
// script's shebang names. For bin/axiomcode that is `bash`, so both wrappers ran a bare `bash.exe`
// from PATH, which on Windows is either missing or WSL's (see plugins/axiomcode/mcp/find-bash.js).
// A Node shebang makes npm's wrappers run node, which is always there, and the choice of bash is
// made by find-bash.js instead of by PATH. npx goes through the same wrappers, so this is also how
// `npx -y @axiomcode/code-graph mcp` starts on Windows.
//
// node resolves this file through the .bin symlink before setting __dirname, so bin/axiomcode is
// found beside it and its own root walk (#886) starts inside the package, as before.
//
// Python is chosen here too (#1331): the query verbs call `python3`, which a python.org install on Windows does
// not provide. find-python.js hands bash a python3 that runs whichever interpreter answered. A build needs no
// Python, so none found is not an error here; a verb that needs it says so from scripts/axiomcode.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const { findBash } = require('../plugins/axiomcode/mcp/find-bash.js');
const { findPython, withPython } = require('../plugins/axiomcode/mcp/find-python.js');

function fail(msg) {
  process.stderr.write(`❌ ${msg}\n`);
  process.exit(127);
}

// `axiomcode --version` is answered here, before bash is looked for: it is what a user runs to check an install,
// including one whose bash cannot be found. bin/axiomcode answers it the same way when run from a checkout.
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(`${require('../package.json').version}\n`);
  process.exit(0);
}

// THE NODE FLOOR, SAID BEFORE ANYTHING RUNS. The graph is written with node:sqlite, which Node ships without a flag from
// 22.13 (and 23.4); on 22.5-22.12 the index failed minutes in with "No such built-in module: node:sqlite". Asked by
// version, not by loading the module, which would print Node's experimental-feature warning on every command.
const [nodeMaj, nodeMin] = process.versions.node.split('.').map(Number);
if (!(nodeMaj > 23 || (nodeMaj === 23 && nodeMin >= 4) || (nodeMaj === 22 && nodeMin >= 13))) {
  fail(`axiomcode needs Node 22.13 or newer (it writes the graph with node:sqlite); this is Node ${process.versions.node}.`);
}

const { bash, error } = findBash();
if (error) fail(error);
const py = findPython();
// AXIOMCODE_BASH too, for the builds Python starts: a bare `bash` from Python on Windows is WSL's or nothing.
const env = { ...(py.exe ? withPython(process.env, py) : process.env), AXIOMCODE_BASH: bash };
const r = spawnSync(bash, [path.join(__dirname, 'axiomcode'), ...args], { stdio: 'inherit', env });
if (r.error) fail(`could not start bash: ${r.error.message}`);
// Die of the same signal the CLI died of, so a caller sees what really happened.
if (r.signal) process.kill(process.pid, r.signal);
process.exit(r.status ?? 1);
