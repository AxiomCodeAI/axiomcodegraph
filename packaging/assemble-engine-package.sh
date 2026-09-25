#!/usr/bin/env bash
# Assemble one @axiomcode/engine-<os>-<cpu> npm package from the compiled engines.
#   assemble-engine-package.sh <platform> <version> <engines-dir> <out-dir>
# <engines-dir> holds <lang>/axiomcode-engine-<lang>[.exe] and <lang>/ENGINE_ID for every
# language CI built for that platform, and queries/axiomcode-query-<name>[.exe] + queries/<name>.id
# for every query program the CLI runs (impact, path …). The package carries them verbatim plus a package.json
# whose os/cpu fields let npm install it only on a matching machine.
set -eu
platform="$1"; version="$2"; src="$3"; out="$4"
os="${platform%%-*}"; cpu="${platform#*-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../graph/pipeline/engine.conf"
rm -rf "$out"; mkdir -p "$out"
cp -R "$src"/. "$out/"
langs="$(ls -d "$out"/*/ | xargs -n1 basename | grep -vx queries | tr '\n' ' ')"
queries="$(ls "$out"/queries/*.id 2>/dev/null | xargs -n1 basename 2>/dev/null | sed 's/\.id$//' | tr '\n' ' ')"
case "$platform" in
  darwin-arm64) label="macOS (Apple Silicon)";; darwin-x64) label="macOS (Intel)";;
  linux-x64) label="Linux x64";; linux-arm64) label="Linux arm64";; win32-x64) label="Windows x64";;
  *) label="$os $cpu";;
esac
sed -e "s|@@SCOPE@@|$ENGINE_PACKAGE_SCOPE|g" -e "s|@@PLATFORM@@|$platform|g" -e "s|@@VERSION@@|$version|g" \
    -e "s|@@OS@@|$os|g" -e "s|@@CPU@@|$cpu|g" -e "s|@@LANGS@@|${langs% }|g" -e "s|@@LABEL@@|$label|g" \
    "$HERE/engine-package.json" > "$out/package.json"
cp "$HERE/../LICENSE.md" "$out/LICENSE.md"
{ echo "# $ENGINE_PACKAGE_SCOPE/engine-$platform"; echo
  echo "The $label engine for AxiomCode Graph ([$ENGINE_PACKAGE_SCOPE/code-graph](https://www.npmjs.com/package/$ENGINE_PACKAGE_SCOPE/code-graph)),"
  echo "a resolved call graph of your codebase grounded in formal methods."; echo
  echo "Installed automatically with \`$ENGINE_PACKAGE_SCOPE/code-graph\` on $label; you don't need to install it yourself."
  echo; echo "Languages: ${langs% }."
  echo; echo "Rules each engine was built from:"; echo
  for l in $langs; do echo "- $l: \`$(cat "$out/$l/ENGINE_ID")\`"; done
  if [ -n "$queries" ]; then
    echo; echo "Query programs (\`axiomcode impact\`, \`axiomcode path\` …), by the rules each was built from:"; echo
    for q in $queries; do echo "- $q: \`$(cat "$out/queries/$q.id")\`"; done
  fi
} > "$out/README.md"
chmod +x "$out"/*/axiomcode-engine-* "$out"/queries/axiomcode-query-* 2>/dev/null || true
echo "assembled $out: $(ls "$out" | tr '\n' ' ')"
