#!/usr/bin/env bash
# Assemble one @axiomcode/engine-<os>-<cpu> npm package from the compiled engines.
#   assemble-engine-package.sh <platform> <version> <engines-dir> <out-dir>
# <engines-dir> holds <lang>/axiomcode-engine-<lang>[.exe] and <lang>/ENGINE_ID for every
# language CI built for that platform. The package carries them verbatim plus a package.json
# whose os/cpu fields let npm install it only on a matching machine.
set -eu
platform="$1"; version="$2"; src="$3"; out="$4"
os="${platform%%-*}"; cpu="${platform#*-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../graph/pipeline/engine.conf"
rm -rf "$out"; mkdir -p "$out"
cp -R "$src"/. "$out/"
langs="$(ls -d "$out"/*/ | xargs -n1 basename | tr '\n' ' ')"
sed -e "s|@@SCOPE@@|$ENGINE_PACKAGE_SCOPE|g" -e "s|@@PLATFORM@@|$platform|g" -e "s|@@VERSION@@|$version|g" \
    -e "s|@@OS@@|$os|g" -e "s|@@CPU@@|$cpu|g" -e "s|@@LANGS@@|${langs% }|g" -e "s|@@SOUFFLE@@|$SOUFFLE_VERSION|g" \
    "$HERE/engine-package.json" > "$out/package.json"
cp "$HERE/../LICENSE.md" "$out/LICENSE.md"
{ echo "# $ENGINE_PACKAGE_SCOPE/engine-$platform"; echo
  echo "Prebuilt AxiomCode code-graph engines for $os/$cpu: ${langs% }. Installed automatically as an"
  echo "optional dependency of the code-graph package on a matching machine; not meant to be used directly."
  echo; for l in $langs; do echo "- $l: rules id \`$(cat "$out/$l/ENGINE_ID")\`"; done
} > "$out/README.md"
chmod +x "$out"/*/axiomcode-engine-* 2>/dev/null || true
echo "assembled $out: $(ls "$out" | tr '\n' ' ')"
