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
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHIM = path.join(__dirname, '..', 'skills', 'axiomcode', 'scripts', 'pyshim');

function candidates() {
  return [process.env.AXIOMCODE_PYTHON && [process.env.AXIOMCODE_PYTHON], ['python3'], ['python'],
          process.platform === 'win32' && ['py', '-3']].filter(Boolean);
}

// { cmd, exe } or { error }: cmd is how the candidate was named, exe the interpreter file it runs.
// THE PROBE IS REMEMBERED. It starts an interpreter, and it ran on every `axiomcode` command and on every hook, which fire
// on every tool call an agent makes: one Python start each time, before the work, and on a busy Windows machine that is
// the slowest process there is to start. Its answer depends only on what each candidate name resolves to on PATH, so it is
// kept in the temp directory under a key of PATH and AXIOMCODE_PYTHON, with the file every candidate it tried resolved to
// (and that file's mtime). A later call re-resolves those names -- a stat per directory, no process -- and probes again
// only when one of them resolves elsewhere, or the file changed: a Python installed, removed or upgraded.
// AXIOMCODE_NO_PYTHON_CACHE=1 probes every time.
function onPath(name) {
  if (process.platform === 'win32' || path.isAbsolute(name) || /[\\/]/.test(name)) {
    const p = process.platform === 'win32' ? which(name) : name;
    if (!p) return null;
    try { return [p, fs.statSync(p).mtimeMs]; } catch { return null; }
  }
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d || !path.isAbsolute(d)) continue;
    const p = path.join(d, name);
    try { const st = fs.statSync(p); if (st.isFile()) return [p, st.mtimeMs]; } catch { /* not here */ }
  }
  return null;
}

function cacheFile() {
  const key = crypto.createHash('sha1').update([process.platform, process.arch, process.env.PATH || process.env.Path || '',
    process.env.AXIOMCODE_PYTHON || ''].join('\0')).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `axiomcode-python-${key}.json`);
}

function cached() {
  if (process.env.AXIOMCODE_NO_PYTHON_CACHE) return null;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    for (const [name, was] of c.seen) {
      const now = onPath(name);
      if (JSON.stringify(now) !== JSON.stringify(was)) return null;
    }
    if (!fs.statSync(c.exe).isFile()) return null;
    return { cmd: c.cmd, exe: c.exe };
  } catch { return null; }
}

function remember(found, seen) {
  if (process.env.AXIOMCODE_NO_PYTHON_CACHE) return;
  try {
    const f = cacheFile(), tmp = `${f}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ cmd: found.cmd, exe: found.exe, seen }));
    fs.renameSync(tmp, f);
  } catch { /* a read-only temp directory only costs the probe next time */ }
}

function findPython() {
  const hit = cached();
  if (hit) return hit;
  const seen = [];
  for (const cmd of candidates()) {
    seen.push([cmd[0], onPath(cmd[0])]);
    const exe0 = which(cmd[0]);                                  // PATH only: never a python.exe in the current directory
    if (!exe0) continue;
    const r = spawnSync(exe0, [...cmd.slice(1), '-c', 'import sys; print(sys.executable)'],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 15000 });
    const exe = r.status === 0 && String(r.stdout).trim();
    if (exe) { const found = { cmd, exe }; remember(found, seen); return found; }
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
