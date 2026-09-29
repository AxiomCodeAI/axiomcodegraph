function helper(): number { return 1; }

// same file, unexported: nested literal and arrow property
const handlers = {
  jobs: { run: () => helper(), stop() { return 0; } },
};
export function drive() { handlers.jobs.run(); return handlers.jobs.stop(); }

// control: only a property whose VALUE is a literal is followed. `cfg.name` is a string, so
// `cfg.name.trim()` is String#trim, never the literal's own `trim` one level up.
const cfg = { name: ' x ', trim() { return 1; } };
export function trimName() { return cfg.name.trim(); }
