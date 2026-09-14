/**
 * Stripping a TypeScript module extension, in ONE place.
 *
 * ## Why this file exists
 *
 * The alternation was written out three times — in the project analyzer, the
 * module extractor and the IR-completeness checker — and each copy listed the
 * arms in an order that is wrong for the two declaration extensions that are
 * not `.d.ts`:
 *
 *     /\.(d\.ts|tsx?|mts|cts)$/
 *
 * For `index.d.cts` the `d\.ts` arm cannot match, `tsx?` cannot, `mts` cannot —
 * and the bare `cts` arm **does**, stripping only `.cts` and leaving `index.d`.
 * `.d.mts` fails the same way. A longest-first arm order is the whole fix, and
 * #89 fixed exactly one of the three copies, which is what this file prevents:
 * the module's `name` kept the stray `.d` for another release because a second
 * copy was never touched.
 *
 * `.d.cts` and `.d.mts` are not exotic. They are what every dual-published
 * package ships; rxjs alone accounted for 1,170 affected rows.
 *
 * ## The arm order is load-bearing
 *
 * `d\.ts|d\.mts|d\.cts` must precede `tsx?|mts|cts`. Alternation is ordered, so
 * putting the two-part forms first is what makes `index.d.cts` match `d\.cts`
 * and not `cts`. Verified unchanged for every extension already handled:
 * `.d.ts`, `.ts`, `.tsx`, `.mts`, `.cts`, a bare `x.d` and `foo.bar.cts`.
 *
 * ## Three callers, three arm sets, deliberately
 *
 * They are not interchangeable and were never meant to be:
 *
 *   - {@link stripTsExtension} — TypeScript source only. Feeds
 *     `toProjectRelative`, and therefore a module's `qualifiedName`.
 *   - {@link stripTsOrJsonExtension} — adds `.json`, for `resolveJsonModule`.
 *     Feeds a module's `name`.
 *   - {@link stripTsOrJsExtension} — adds the JavaScript forms, so a `./a.js`
 *     specifier and the `a.ts` it resolved to compare equal.
 *
 * Sharing the ARMS while keeping the sets distinct is the point; collapsing
 * them into one would silently change which extensions each caller strips.
 */

/** TypeScript's own source extensions, two-part declaration forms FIRST. */
const TS_ARMS = String.raw`d\.ts|d\.mts|d\.cts|tsx?|mts|cts`;

const TS_EXTENSION = new RegExp(String.raw`\.(${TS_ARMS})$`);
const TS_OR_JSON_EXTENSION = new RegExp(String.raw`\.(${TS_ARMS}|json)$`);
const TS_OR_JS_EXTENSION = new RegExp(String.raw`\.(${TS_ARMS}|jsx?|mjs|cjs)$`);

/** `app/web/views` for `app/web/views.ts`, `app/web/views.d.ts` and `…/views.d.cts`. */
export function stripTsExtension(filePath: string): string {
  return filePath.replace(TS_EXTENSION, '');
}

/** As {@link stripTsExtension}, and also strips `.json` under `resolveJsonModule`. */
export function stripTsOrJsonExtension(filePath: string): string {
  return filePath.replace(TS_OR_JSON_EXTENSION, '');
}

/** As {@link stripTsExtension}, and also the JavaScript forms, so `./a.js` matches `a.ts`. */
export function stripTsOrJsExtension(filePath: string): string {
  return filePath.replace(TS_OR_JS_EXTENSION, '');
}
