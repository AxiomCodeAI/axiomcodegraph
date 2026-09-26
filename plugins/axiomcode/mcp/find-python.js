// find-python.js — the Python the CLI and the hooks run under, found rather than assumed (#1331).
//
// Every verb and every hook is a Python script, and the bash half of the CLI calls it as `python3`. A
// python.org install on Windows provides python.exe and py.exe and no python3, and on a desktop Windows
// `python3` is the Microsoft Store placeholder, which is on PATH and exits 9009. So the interpreter is
// probed in the order launch.js has always used for the MCP server: AXIOMCODE_PYTHON, python3, python,
// and on Windows `py -3`. A candidate is taken only if it runs, and it reports its own sys.executable, so
// what bash is handed is a real file and not the py launcher or a placeholder.
//
// bash is then given a `python3` that runs it: skills/axiomcode/scripts/pyshim/python3, first on PATH,
// which execs AXIOMCODE_PYTHON_EXE. Python's own children use sys.executable and need nothing.
//
// Used by bin/axiomcode.js (the command npm links), mcp/launch.js (the MCP server) and hooks/run.js.
'use strict';
const { spawnSync } = require('child_process');
const { which } = require('./which.js');
const path = require('path');

const SHIM = path.join(__dirname, '..', 'skills', 'axiomcode', 'scripts', 'pyshim');

function candidates() {
  return [process.env.AXIOMCODE_PYTHON && [process.env.AXIOMCODE_PYTHON], ['python3'], ['python'],
          process.platform === 'win32' && ['py', '-3']].filter(Boolean);
}

// { cmd, exe } or { error }: cmd is how the candidate was named, exe the interpreter file it runs.
function findPython() {
  for (const cmd of candidates()) {
    const exe0 = which(cmd[0]);                                  // PATH only: never a python.exe in the current directory
    if (!exe0) continue;
    const r = spawnSync(exe0, [...cmd.slice(1), '-c', 'import sys; print(sys.executable)'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 15000 });
    const exe = r.status === 0 && String(r.stdout).trim();
    if (exe) return { cmd, exe };
  }
  return { error: 'axiomcode needs Python 3, and no python3, python' + (process.platform === 'win32' ? ' or py -3' : '') +
    ' on PATH runs.\n   • install it (https://www.python.org/downloads/), or\n' +
    '   • set AXIOMCODE_PYTHON to the full path of a python executable.' };
}

// A copy of env in which bash's `python3` is the interpreter findPython chose. On POSIX, when that is
// python3 itself, PATH is left alone. On Windows the shim always goes first: a python3 that answered a
// probe from here can still be a Store alias that Git Bash cannot run.
function withPython(env, py) {
  const out = { ...env, AXIOMCODE_PYTHON_EXE: py.exe.replace(/\\/g, '/') };
  // and every program started below — python, git, bash, the engine — skips the current directory when it looks a
  // bare name up (see which.js); Windows reads this variable from the environment of the process that starts one
  if (process.platform === 'win32' && out.NoDefaultCurrentDirectoryInExePath === undefined) out.NoDefaultCurrentDirectoryInExePath = '1';
  // Windows Python writes a pipe in the ANSI code page and opens files in it, so the first → in an answer raised
  // UnicodeEncodeError, and a source file in UTF-8 read wrong. UTF-8 mode fixes both; a user's own setting stands.
  if (process.platform === 'win32' && out.PYTHONUTF8 === undefined) out.PYTHONUTF8 = '1';
  // Git Bash's runtime expands wildcards in the arguments a native Windows process hands it, since no shell did:
  // `axiomcode path '*' X` reached the CLI as the working directory's file names. noglob turns that off for every
  // bash below (the CLI's, the MCP server's, the hooks'); other MSYS options a user set are kept.
  if (process.platform === 'win32' && !/(^|\s)noglob(\s|$)/.test(out.MSYS || '')) out.MSYS = ((out.MSYS || '') + ' noglob').trim();
  if (process.platform !== 'win32' && py.cmd.length === 1 && py.cmd[0] === 'python3') return out;
  // Windows keeps it as Path, and a second PATH key beside it would be one of two the child picks from.
  const key = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  out[key] = out[key] ? SHIM + path.delimiter + out[key] : SHIM;
  return out;
}

module.exports = { candidates, findPython, withPython };
