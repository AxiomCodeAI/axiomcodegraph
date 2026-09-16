// An accessor is invoked by the access (#703). Every read of a `get` member and every
// assignment to a `set` member is an edge to the accessor, with no written call.

export class Request {
  #raw: { url: string; method: string };
  #routePath = "";
  constructor(raw: { url: string; method: string }) {
    this.#raw = raw;
  }
  get url(): string {                       // read through a chain: c.req.url
    return this.#raw.url;
  }
  get method(): string {                    // read as a call's callee: c.req.method.toUpperCase()
    return this.#raw.method;
  }
  get routePath(): string {                 // read and written through one name
    return this.#routePath;
  }
  set routePath(p: string) {
    this.#routePath = p;
  }
  static get empty(): Request {             // a static getter, reached through the class name
    return new Request({ url: "", method: "GET" });
  }
}

export class Context {
  #req: Request;
  #res: Response | undefined;
  hits = 0;
  constructor(req: Request) {
    this.#req = req;
  }
  get req(): Request {
    return this.#req;
  }
  get res(): Response {                     // a getter/setter pair: `=` runs the setter only
    return this.#res ?? new Response();
  }
  set res(r: Response) {
    this.#res = r;
  }
  get count(): number {                     // `+=` and `++` read then write
    return this.hits;
  }
  set count(n: number) {
    this.hits = n;
  }
}

/** A subclass override: the receiver's exact type selects the one getter. */
export class LoggedContext extends Context {
  get req(): Request {
    return super.req;
  }
}
