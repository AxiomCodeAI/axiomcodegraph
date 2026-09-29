export function readLibPrefixes(files: string[]): string[] {
  const labelOf = new Map<string, string>();
  let changed = false;
  for (const f of files) {
    if (!labelOf.has(f)) { labelOf.set(f, f.toUpperCase()); changed = true; }
  }
  return changed ? files.map((f) => labelOf.get(f) ?? f) : files;
}

export function load(url: string) {
  return new Remote(url);
}

export function isOk(code: number) {
  return code === Codes.OK;
}

export function lookup(key: string) {
  return Registry.find(key);
}

export function upload(send: (p: object) => void, body: string) {
  send({ Bucket: "b", Body: body });
}

export function main() {
  readLibPrefixes(["a", "b"]);
  load("x");
}
