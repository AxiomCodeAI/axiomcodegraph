// Case 69 — A ROUTE HANDLER IS A ROOT WHETHER OR NOT IT WAS WRITTEN INLINE.
//
// The rule used to reach the handler through `callback_arg`, which reads the declaration
// an expression INTRODUCES, so a function declared elsewhere and passed by name
// introduced nothing and was dropped -- having satisfied the verb and path guards
// exactly as the inline form did (#1110). Case 68 covers the decorator frameworks and
// registers no route, so nothing pinned this.
//
// The negative rows carry the weight. `get` and `delete` are ordinary method names all
// over this ecosystem -- Map, Set, Headers, every cache -- so the path guard is the only
// thing between this rule and a fabricated root on each of them. A wrong root makes dead
// code look alive, which is the direction this layer must not fail in.

declare const app: {
  get(path: string, h: unknown): void;
  post(path: string, h: unknown): void;
};
declare const cache: Map<string, string>;
declare const headers: { delete(name: string): void };
declare function registerAll(handlers: Record<string, () => string>): void;
declare function it(name: string, body: () => void): void;

// ── ROOT: an inline arrow at a route (already worked) ───────────────────────
app.get('/inline', () => { inlineWork(); });
function inlineWork(): string { return 'inline'; }

// ── ROOT: a NAMED handler at a route (#1110) ────────────────────────────────
function namedHandler(): string { return namedWork(); }
function namedWork(): string { return 'named'; }
app.post('/named', namedHandler);

// ── ROOT: a NAMED body at a test registrar (the same fix, other rule) ───────
function namedSpec(): void { specWork(); }
function specWork(): string { return 'spec'; }
it('runs', namedSpec);

// ── NOT A ROOT: a route verb with NO path argument ──────────────────────────
// Without the path guard this would make every declaration passed to any `get` a route.
function notAHandler(): string { return 'ordinary'; }
cache.get(notAHandler());

// ── NOT A ROOT: a path-shaped string at a NON-route verb ────────────────────
headers.delete('/looks-like-a-path');

// ── NOT A ROOT: a callable reached through an OBJECT PROPERTY VALUE ─────────
// The parser resolves this reference exactly as it resolves the argument above, but
// there is no verb and no path to discriminate on, so this layer declines. If this
// name ever appears in the golden, a rule has been written without a guard.
function mappedHandler(): string { return 'mapped'; }
registerAll({ '/mapped': mappedHandler });
