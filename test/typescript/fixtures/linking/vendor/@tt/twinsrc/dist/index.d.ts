// The PUBLISHED surface. The manifest's `types` points here, so this is the copy that
// must be staged — and it is checked in as SOURCE, not built. See the .gitignore
// exception that keeps `dist/` from swallowing it.
export declare class Twin {
  ping(): string;
}
