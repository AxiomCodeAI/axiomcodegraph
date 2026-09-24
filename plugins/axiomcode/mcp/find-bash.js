// find-bash.js — the bash the CLI runs under, chosen here rather than by PATH (#1229, #1233).
//
// Everything that runs axiomcode is a bash script, and on POSIX a bare `bash` is the right one. On
// Windows it never is. A default Git for Windows install puts Git\cmd on PATH, not Git\bin, so there is
// no bash at all; and once WSL is installed, a bare `bash` resolves to WSL's (C:\Windows\System32 or the
// WindowsApps alias), which runs this Windows install inside Linux, where neither the Windows node nor a
// C:/ path exists, and the script dies with "No such file or directory", exit 127. So on Windows PATH is
// never searched: Git's own bash is located from `git --exec-path`, then from the default install places.
//
// Git\bin\bash.exe is the one to take: it is the wrapper that puts mingw64/bin and usr/bin on PATH, which
// the pipeline needs. usr\bin\bash.exe alone does not.
//
// Used by bin/axiomcode.js (the command npm links) and mcp/launch.js (the plugin's MCP server).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function gitBash() {
  const candidates = [];
  try {
    // <git>/mingw64/libexec/git-core, or <git>/libexec/git-core on some layouts.
    const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    for (let d = path.resolve(exec), i = 0; i < 4; i++, d = path.dirname(d)) candidates.push(path.join(d, 'bin', 'bash.exe'));
  } catch { /* no git on PATH: fall through to the default locations */ }
  const env = process.env;
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
    if (base) candidates.push(path.join(base, 'Git', 'bin', 'bash.exe'));
  }
  return candidates.find((p) => fs.existsSync(p));
}

// { bash } or { error }: callers decide how to fail, because the MCP launcher must say it on stderr and
// still leave the client a reason, while the command exits 127 as a shell would for a missing program.
function findBash() {
  const override = process.env.AXIOMCODE_BASH;
  if (override) {
    return fs.existsSync(override) ? { bash: override } : { error: `AXIOMCODE_BASH is set to ${override}, which does not exist.` };
  }
  if (process.platform !== 'win32') return { bash: 'bash' };
  const found = gitBash();
  if (found) return { bash: found };
  return { error: 'axiomcode needs the bash that comes with Git for Windows, and none was found.\n' +
    '   • install Git for Windows (https://git-scm.com/download/win), or\n' +
    '   • set AXIOMCODE_BASH to the full path of a Git Bash bash.exe (not C:\\Windows\\System32\\bash.exe, which is WSL).' };
}

module.exports = { findBash };
