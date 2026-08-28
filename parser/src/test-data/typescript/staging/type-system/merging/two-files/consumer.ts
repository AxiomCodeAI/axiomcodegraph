// fixture: type-system/merging/two-files/consumer
// nature: runtime-bearing
//
// Consumes the merged `AppConfig`, reading members contributed by BOTH files.
// A model that resolves `AppConfig` to a single declaration will find only
// half of these members.

function describeConfig(config: AppConfig): string {
    return [
        config.name, // from config-a.ts
        config.version, // from config-a.ts
        String(config.retries), // from config-b.ts
        String(config.endpoints.length), // from config-b.ts
    ].join("|");
}

class LoggingPlugin implements Plugin {
    readonly id = "logging"; // required by config-a.ts

    setup(config: AppConfig): void {
        // required by config-b.ts
        void describeConfig(config);
    }
}

const plugin: Plugin = new LoggingPlugin();
void plugin;
