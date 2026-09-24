// A CALL ON AN EXPRESSION CALLEE. `(opt?.fetch || defaultFetch)(url)` calls whichever operand is set; neither is a
// holder the call names, and the value that reaches `opt.fetch` is a property of an object literal passed as the
// argument. Both functions can run.
export type Fetch = (url: string) => string

export interface Options {
  fetch?: Fetch
}

export function defaultFetch(url: string): string {
  return 'default:' + url
}

export const customFetch: Fetch = (url) => 'custom:' + url

export function get(url: string, opt?: Options): string {
  return (opt?.fetch || defaultFetch)(url)
}

export function load(): string {
  return get('a', { fetch: customFetch })
}
