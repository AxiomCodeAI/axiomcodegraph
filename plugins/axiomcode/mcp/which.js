// which.js — a program's full path from PATH alone, never from the current directory (Windows).
//
// Windows looks in the CURRENT DIRECTORY before PATH when a program is started by bare name, and Node's spawn does
// the same. A repository holding a git.exe, a python.exe or a py.exe — a vendored tool, an installer someone
// downloaded into it — then runs instead of the real one: the finders' `git --exec-path` probe started a Git
// installer that waited, invisibly, for ever, and every build from that directory hung. So on Windows a bare name
// is resolved here, over PATH and PATHEXT only, and the absolute path is what gets started. Elsewhere the name is
// returned as is: POSIX never searches the current directory for a bare name.
'use strict';
const fs = require('fs');
const path = require('path');

function which(name) {
  if (process.platform !== 'win32' || path.isAbsolute(name) || /[\\/]/.test(name)) return name;
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter((d) => d && d !== '.');
  for (const d of dirs) {
    if (!path.isAbsolute(d)) continue;
    for (const e of path.extname(name) ? [''] : exts) {
      const p = path.join(d, name + e);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

module.exports = { which };
