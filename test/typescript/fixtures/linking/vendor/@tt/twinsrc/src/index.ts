// The package's own TypeScript SOURCE, shipped alongside the build the way rxjs, immer
// and superjson all ship theirs. The parser skips `dist` by name but NOT `src`, so a
// naive root staging walks in here and declares `Twin` a second time.
//
// The bodies differ from the declarations on purpose: if the engine ever answers with
// THIS copy the fixture should be able to tell, and a reader should not mistake the two
// files for a copy-paste accident.
export class Twin {
  ping(): string {
    return 'from source, which is not the published surface';
  }
}
