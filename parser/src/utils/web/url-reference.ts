import * as fs from 'fs';
import * as path from 'path';

import { WebUrlKind } from '@/enums/web/WebUrlKind';

/** A URL as a page or a stylesheet wrote it, classified and split. */
export interface ClassifiedUrl {
  readonly kind: WebUrlKind;
  /** The part before `?` and `#`, as written (percent-encoding kept). */
  readonly path: string;
  /** After `?`, before `#`; empty when absent. */
  readonly query: string;
  /** After `#`; empty when absent. */
  readonly fragment: string;
}

/** What a page's `<base href>` contributes: the kind and path every relative URL is joined onto. */
export interface BaseUrl {
  readonly kind: WebUrlKind;
  readonly path: string;
}

/** `base` joined with a relative URL path, as a browser resolves it: `/app/` + `page.html` is `/app/page.html`. */
export function joinUrlPath(base: string, relative: string): string {
  const directory = base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1);
  return directory + relative;
}

/** A relative URL re-rooted on the page's `<base href>`, when there is one; any other URL as classified. */
export function applyBase(classified: ClassifiedUrl, base: BaseUrl | undefined): ClassifiedUrl {
  return base !== undefined && classified.kind === WebUrlKind.RELATIVE
    ? { ...classified, kind: base.kind, path: joinUrlPath(base.path, classified.path) }
    : classified;
}

export const TEMPLATE_MARKER = /\{\{|\{%|<%|<\?|\$\{|@\{|\{#/;

/**
 * Directories a server conventionally serves as `/`: a root-relative URL is tried under
 * each of these beneath every directory between the file and the project root. `dist`,
 * `build` and `out` are not here because the walks never enter them.
 */
export const WEB_ROOT_DIRECTORIES = ['public', 'static', 'www', 'wwwroot', 'web', 'htdocs', 'site', 'assets', 'src', 'app', 'resources'] as const;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Classifies a URL from its text alone. A template marker anywhere in it makes it a
 * TEMPLATE_EXPRESSION before any other rule applies: `{{ static('x.css') }}` names
 * nothing on disk, and `/static/{{ name }}.js` does not either.
 */
export function classifyUrl(raw: string): ClassifiedUrl {
  const url = raw.trim();
  if (url === '') {
    return { kind: WebUrlKind.EMPTY, path: '', query: '', fragment: '' };
  }
  if (TEMPLATE_MARKER.test(url)) {
    return { kind: WebUrlKind.TEMPLATE_EXPRESSION, path: url, query: '', fragment: '' };
  }
  const { base, query, fragment } = split(url);
  if (url.startsWith('#')) {
    return { kind: WebUrlKind.FRAGMENT, path: '', query: '', fragment };
  }
  if (url.startsWith('//')) {
    return { kind: WebUrlKind.PROTOCOL_RELATIVE, path: base, query, fragment };
  }
  const scheme = SCHEME.exec(url)?.[0].slice(0, -1).toLowerCase();
  if (scheme !== undefined) {
    if (scheme === 'http' || scheme === 'https') {
      return { kind: WebUrlKind.ABSOLUTE, path: base, query, fragment };
    }
    if (scheme === 'data') {
      return { kind: WebUrlKind.DATA_URI, path: '', query: '', fragment: '' };
    }
    if (scheme === 'javascript') {
      return { kind: WebUrlKind.JAVASCRIPT_URI, path: '', query: '', fragment: '' };
    }
    // `C:\x` is a Windows path, not a scheme, but a page never names one; a one-letter
    // scheme is still OTHER_SCHEME here because `file:` and `about:` are what appear.
    return { kind: WebUrlKind.OTHER_SCHEME, path: base, query, fragment };
  }
  if (url.startsWith('/')) {
    return { kind: WebUrlKind.ROOT_RELATIVE, path: base, query, fragment };
  }
  return { kind: WebUrlKind.RELATIVE, path: base, query, fragment };
}

function split(url: string): { base: string; query: string; fragment: string } {
  let rest = url;
  let fragment = '';
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  let query = '';
  const q = rest.indexOf('?');
  if (q >= 0) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }
  return { base: rest, query, fragment };
}

/**
 * The file a RELATIVE or ROOT_RELATIVE URL names, when it exists; `''` otherwise.
 *
 * A relative URL resolves against the referring file's directory, as a browser does.
 * A root-relative one resolves against the served root, which the parser cannot know:
 * it tries the project root, every directory between the file and that root, and the
 * conventionally served directory names (`public/`, `static/`, `www/`, …) under each of
 * those, and accepts the answer only when EXACTLY ONE of them holds the file —
 * `/static/app.js` under `public/static/app.js` is that case, and two candidates is a
 * guess the parser refuses to make. Nothing outside the project root is ever returned: a `../../etc`
 * URL that escapes the root is a reference to nothing the repository holds.
 */
export function resolveUrlToFile(
  url: ClassifiedUrl,
  fromFile: string,
  projectRoot: string,
  /**
   * The repository the walk read (V1-05): a RELATIVE url may climb out of the sub-project the file belongs to
   * (`../shared.css` from a page in a folder that holds its own main.js) as a browser serving the repository would.
   * A root-relative url still resolves inside `projectRoot`. Defaults to `projectRoot`.
   */
  repoRoot?: string
): string {
  if (url.path === '') {
    return '';
  }
  let decoded = url.path;
  try {
    decoded = decodeURIComponent(url.path);
  } catch {
    // A `%` that is not an escape: use the text as written.
  }
  const root = path.resolve(projectRoot);
  const inside = (candidate: string): boolean => {
    const rel = path.relative(root, candidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const isFile = (candidate: string): boolean => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  };
  if (url.kind === WebUrlKind.RELATIVE) {
    const candidate = path.resolve(path.dirname(fromFile), decoded);
    const repo = path.resolve(repoRoot ?? projectRoot);
    const rel = path.relative(repo, candidate);
    const insideRepo = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    return (inside(candidate) || insideRepo) && isFile(candidate) ? candidate : '';
  }
  if (url.kind === WebUrlKind.ROOT_RELATIVE) {
    const hits: string[] = [];
    let dir = path.dirname(path.resolve(fromFile));
    const bases = new Set<string>();
    while (inside(dir) || dir === root) {
      bases.add(dir);
      if (dir === root) {
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    bases.add(root);
    const tried = new Set<string>();
    for (const base of [...bases]) {
      for (const webRoot of WEB_ROOT_DIRECTORIES) {
        bases.add(path.join(base, webRoot));
      }
    }
    for (const base of bases) {
      const candidate = path.resolve(base, '.' + decoded);
      if (tried.has(candidate)) {
        continue;
      }
      tried.add(candidate);
      if (inside(candidate) && isFile(candidate)) {
        hits.push(candidate);
      }
    }
    return hits.length === 1 ? hits[0]! : '';
  }
  return '';
}
