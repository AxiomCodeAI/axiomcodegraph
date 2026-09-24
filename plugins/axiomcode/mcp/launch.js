// launch.js — start the MCP server, resolving the Python MCP SDK rather than assuming it.
//
// WHY NODE AND NOT BASH (#1233). The manifests have no per-platform variants, so their command must be
// one program name that means the right thing everywhere. `bash` does not: on Windows it is WSL's or
// nothing (see find-bash.js), and the server never started (CONNECTION_CLOSED). `python3` does not
// either: on Windows it is a Microsoft Store placeholder and a python.org install has only `python`,
// while macOS and Linux may have only `python3`. `node` is the same name on every platform, and building
// a graph already needs it.
//
// server.py imports `mcp`, and nothing on a fresh machine installs it: the plugin declares no Python
// dependency and npm cannot express one. Order: an interpreter that already has the SDK wins (fastest, no
// network, respects a venv the user set up). Otherwise uv fetches it into an ephemeral environment, which
// is the one command that works on a clean machine without asking to install anything globally. Otherwise
// any interpreter that runs, because server.py carries a dependency-free fallback for the sliver of the
// protocol it uses and says on stderr which half it is running (#1105). An interpreter is taken only if
// it actually runs, so the WindowsApps placeholders, which exist on PATH and exit 9009, are passed over.
//
// The server shells out to the CLI, a bash script, so the bash find-bash.js chose is handed to it as
// AXIOMCODE_BASH; a bare `bash` from server.py would hit the same Windows lookup this file avoids.
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { findBash } = require('./find-bash.js');

const SERVER = path.join(__dirname, 'server.py');
// Run as `node launch.js …` the rest of the command line is the server's; required from mcp.json's
// `node -e` there is none.
const args = require.main === module ? process.argv.slice(2) : [];

const runs = (cmd, argv) => spawnSync(cmd[0], [...cmd.slice(1), ...argv], { stdio: 'ignore', windowsHide: true }).status === 0;

const pythons = [process.env.AXIOMCODE_PYTHON && [process.env.AXIOMCODE_PYTHON], ['python3'], ['python'],
                 process.platform === 'win32' && ['py', '-3']].filter(Boolean);

function choose() {
  for (const py of pythons) if (runs(py, ['-c', 'import mcp'])) return [...py, SERVER];
  if (runs(['uv'], ['--version'])) return ['uv', 'run', '--quiet', '--with', 'mcp', 'python', SERVER];
  for (const py of pythons) if (runs(py, ['-c', 'pass'])) return [...py, SERVER];
  return null;
}

const env = { ...process.env };
const { bash, error } = findBash();
if (bash) env.AXIOMCODE_BASH = bash;
else process.stderr.write(`axiomcode mcp: ${error}\n  The server starts, but every tool will say it cannot run the CLI.\n`);

const cmd = choose();
if (!cmd) {
  process.stderr.write('axiomcode mcp: no python3 or python that runs, so the server cannot start at all.\n' +
                       '  The skill\'s CLI needs Python too; install it, or set AXIOMCODE_PYTHON.\n');
  process.exit(1);
}

// stdio is inherited, so the client talks to the server directly and this process only waits. A signal
// sent to it is passed on, so stopping the launcher stops the server rather than orphaning it.
const child = spawn(cmd[0], [...cmd.slice(1), ...args], { stdio: 'inherit', env, windowsHide: true });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('error', (e) => { process.stderr.write(`axiomcode mcp: could not start ${cmd[0]}: ${e.message}\n`); process.exit(1); });
child.on('exit', (code, signal) => {
  if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); }
  process.exit(code ?? 1);
});
