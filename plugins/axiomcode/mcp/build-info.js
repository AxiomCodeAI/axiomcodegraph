// Which BUILD of axiomcode this is: "0.1.6 (1a2b3c4d, 2026-09-28)". The Node half of
// skills/axiomcode/scripts/ax_version.py, which explains the stamp and the rules; the two must print the same line
// (tests/cli_version.py). This half is what `axiomcode --version` runs, on a machine that may have no Python, and it
// writes the stamp:
//
//   node plugins/axiomcode/mcp/build-info.js --write    record the checkout's commit in plugins/axiomcode/build-info.json
//                                                       (package.json's prebuild runs it; without git it keeps the
//                                                       stamp that is there, as an unpacked registry install has one)
//   node plugins/axiomcode/mcp/build-info.js            print the build
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN = path.dirname(__dirname);
const STAMP = 'build-info.json';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

// [short commit, commit date] of root's HEAD when root is the top of its own git repository, else null
function gitHead(root) {
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', timeout: 5000 });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0 || real(top.stdout.trim()) !== real(root)) return null;
  const r = git('log', '-1', '--abbrev=8', '--format=%h %cs');
  const parts = (r.stdout || '').trim().split(/\s+/);
  return r.status === 0 && parts.length === 2 ? parts : null;
}

function build(plugin = PLUGIN) {
  const root = path.dirname(path.dirname(plugin));
  const info = readJson(path.join(plugin, STAMP));
  const version = info.version || readJson(path.join(root, 'package.json')).version
    || readJson(path.join(plugin, '.claude-plugin', 'plugin.json')).version || 'unknown';
  let commit = info.commit, date = info.date, now = null;
  const head = fs.existsSync(path.join(root, 'package.json')) ? gitHead(root) : null;
  if (head && !commit) [commit, date] = head;
  else if (head && !(head[0].startsWith(commit) || commit.startsWith(head[0]))) now = head[0];
  return { version, commit: commit || null, date: date || null, now };
}

function label(b = build()) {
  if (!b.commit) return b.version;
  return `${b.version} (${b.commit}, ${b.date || 'no date'}${b.now ? `; source now at ${b.now}` : ''})`;
}

function writeStamp(plugin = PLUGIN) {
  const root = path.dirname(path.dirname(plugin));
  const head = gitHead(root);
  if (!head) return null;
  const stamp = { version: readJson(path.join(root, 'package.json')).version, commit: head[0], date: head[1] };
  fs.writeFileSync(path.join(plugin, STAMP), JSON.stringify(stamp, null, 2) + '\n');
  return stamp;
}

module.exports = { build, label, writeStamp };

if (require.main === module) {
  if (process.argv[2] === '--write') {
    const s = writeStamp();
    process.stdout.write(s ? `build-info: ${label({ ...s, now: null })}\n` : 'build-info: no git here; the stamp is left as it is\n');
  } else {
    process.stdout.write(label() + '\n');
  }
}
