// fixture: type-system/merging/two-files/config-b
// nature: type-only
//
// The second declaration of `AppConfig`, in a second file. Its members join
// the ones declared in config-a.ts; neither file names the other, and there is
// no import edge between them to follow.

interface AppConfig {
    readonly retries: number;
    readonly endpoints: readonly string[];
}

interface Plugin {
    setup(config: AppConfig): void;
}
