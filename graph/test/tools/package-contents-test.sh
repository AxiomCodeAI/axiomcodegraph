#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# What `npm pack` would actually put in the tarball, and whether an install of it could run.
#
# Every defect this guards against was invisible from a source checkout, which is why none of
# them was caught before: here the parser is built, the CLI is invoked by path, and the
# dependencies are present because a workspace install put them there. The published tarball
# has none of those advantages, and it failed on first use, for every language, on a machine
# where the advice it printed could not be followed.
#
# It reads the pack MANIFEST rather than installing anything, so it costs a second and needs
# no network. --ignore-scripts because `prepare` would otherwise run a full build and print
# over the JSON. The full acceptance test remains an install on a machine with no toolchain.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo "package-contents: SKIP (no node)"; exit 0; }

node - "$ROOT" <<'JS'
const {execFileSync}=require("child_process"), root=process.argv[2], fs=require("fs");
let fail=0, checks=0;
const ok =(m)=>{checks++; if(process.env.PACKAGE_CONTENTS_VERBOSE) console.log("  ok    "+m);};
const bad=(m)=>{checks++; fail=1; console.log("  FAIL  "+m);};

// ---- the manifest fields an installable package needs ----
const j=JSON.parse(fs.readFileSync(root+"/package.json","utf8"));
// Without bin there is no command after install; the CLI exists only as a path in node_modules.
(j.bin&&j.bin.axiomcode) ? ok("bin.axiomcode is declared") : bad("package.json has no bin.axiomcode entry");
// Without files npm falls back to the ignore rules and honours a WORKSPACE .gitignore, which
// is how parser/dist stopped shipping while parser/src/test-data did.
(Array.isArray(j.files)&&j.files.length) ? ok("files is declared") : bad("package.json has no files array");
// The parser ships inside this tarball but is a workspace and is never published, so nothing
// installs what it requires unless this package declares it.
const deps=j.dependencies||{}, pdeps=JSON.parse(fs.readFileSync(root+"/parser/package.json","utf8")).dependencies||{};
Object.keys(deps).length ? ok("runtime dependencies are declared") : bad("package.json declares no runtime dependencies");
for(const k of Object.keys(pdeps)) deps[k] ? ok("dependency hoisted: "+k) : bad("runtime dependency not hoisted from the parser workspace: "+k);

// ---- what the tarball would contain ----
let files;
try{
  files=JSON.parse(execFileSync("npm",["pack","--dry-run","--json","--ignore-scripts"],
    {cwd:root, encoding:"utf8", stdio:["ignore","pipe","ignore"], maxBuffer:64*1024*1024}))[0].files.map(f=>f.path);
}catch(e){ console.log("  FAIL  npm pack --dry-run failed: "+e.message.split("\n")[0]); process.exit(1); }
const has=(p)=>files.includes(p);
const count=(re)=>files.filter(f=>re.test(f)).length;

has("bin/axiomcode") ? ok("ships bin/axiomcode") : bad("does NOT ship bin/axiomcode");
// The corpora are the bulk of the repository and run nothing for a consumer.
count(/^graph\/test\//)===0 ? ok("does not ship graph/test") : bad("ships "+count(/^graph\/test\//)+" files under graph/test");
count(/^parser\/src\/test-data\//)===0 ? ok("does not ship parser test-data") : bad("ships "+count(/^parser\/src\/test-data\//)+" files under parser/src/test-data");
// The rules ARE the engine; the CLI without them installs a tool that cannot solve.
for(const lang of ["java","typescript","python","javascript"]){
  const n=count(new RegExp("^graph/"+lang+"/.*\\.dl$"));
  n>0 ? ok("ships "+n+" "+lang+" rule files") : bad("ships no "+lang+" .dl rules");
}
// Build outputs can only be asserted when they exist. A source checkout that has not been
// built is not a failing package, so this SKIPS rather than failing -- but it must never skip
// silently, because that is exactly how the missing parser went unnoticed.
for(const [dir,probe] of [["dist/", "dist/reason.js"],["parser/dist/","parser/dist/index.js"]]){
  if(!fs.existsSync(root+"/"+probe)){ console.log("  skip  "+dir+" not built in this checkout (run npm run build to assert it ships)"); continue; }
  count(new RegExp("^"+dir.replace("/","\\/")))>0 ? ok("ships "+dir) : bad("does NOT ship "+dir+" (it is built but excluded from the pack)");
}
console.log("package-contents: "+checks+" checks, "+(fail?"FAIL":"PASS"));
process.exit(fail);
JS
