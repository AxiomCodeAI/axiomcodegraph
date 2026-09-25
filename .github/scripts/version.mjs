#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// One version, every manifest that carries it.
//
// The release version is package.json's `version`. It is repeated in the engine
// pins (optionalDependencies — each engine package is published under the same
// version as this one) and every agent plugin manifest a
// marketplace reads. A release where they disagree ships a plugin that reports a
// version nobody can install, or an install that pins engines that were never
// published.
//
//   node .github/scripts/version.mjs check            every manifest agrees
//   node .github/scripts/version.mjs check v0.2.0     ...and agrees with this tag
//   node .github/scripts/version.mjs set 0.2.0        write it everywhere
//   node .github/scripts/version.mjs get              print it
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// [file, JSON path to the version, ...] — optionalDependencies are listed by
// reading the file, so a fifth platform is covered without editing this list.
const MANIFESTS = [
  'package.json',
  'gemini-extension.json',
  'plugins/axiomcode/.claude-plugin/plugin.json',
  'plugins/axiomcode/.codex-plugin/plugin.json',
  'plugins/axiomcode/.cursor-plugin/plugin.json',
];
const ENGINE_PREFIX = '@axiomcode/engine-';
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));

function locations() {
  const out = [];
  for (const f of MANIFESTS) {
    const j = read(f);
    out.push({ file: f, key: 'version', value: j.version });
    if (f === 'package.json') {
      for (const [name, v] of Object.entries(j.optionalDependencies || {})) {
        if (name.startsWith(ENGINE_PREFIX)) out.push({ file: f, key: `optionalDependencies.${name}`, value: v });
      }
    }
  }
  return out;
}

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'get') {
  console.log(read('package.json').version);
} else if (cmd === 'check') {
  const want = arg ? arg.replace(/^v/, '') : read('package.json').version;
  const locs = locations();
  const bad = locs.filter((l) => l.value !== want);
  if (!SEMVER.test(want)) bad.unshift({ file: arg ? 'tag' : 'package.json', key: 'version', value: `${want} (not semver)` });
  if (bad.length) {
    console.log(`::error::version ${want} is not what every manifest says`);
    for (const b of bad) console.log(`  ${b.file}  ${b.key} = ${b.value}`);
    console.log('fix with: node .github/scripts/version.mjs set <version>');
    process.exit(1);
  }
  console.log(`version ${want}: ${locs.length} locations agree`);
} else if (cmd === 'set') {
  if (!arg || !SEMVER.test(arg)) { console.error('usage: version.mjs set <x.y.z[-pre]>'); process.exit(2); }
  // Rewrites the strings in place rather than re-serialising, so a manifest keeps
  // its own formatting and the diff is exactly the version lines.
  for (const f of MANIFESTS) {
    let text = readFileSync(join(root, f), 'utf8');
    text = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${arg}$2`);
    text = text.replace(/("@axiomcode\/engine-[^"]+"\s*:\s*")[^"]*(")/g, `$1${arg}$2`);
    writeFileSync(join(root, f), text);
  }
  const bad = locations().filter((l) => l.value !== arg);
  if (bad.length) {
    for (const b of bad) console.error(`  not updated: ${b.file} ${b.key} = ${b.value}`);
    process.exit(1);
  }
  console.log(`version set to ${arg}: ${locations().length} locations`);
} else {
  console.error('usage: version.mjs check [tag] | set <version> | get');
  process.exit(2);
}
