import { Context, LoggedContext, Request } from "./request";
import { Gauge } from "../lib/metrics";

export function handle(c: Context): string {
  const u = c.req.url;                      // Context#req, then Request#url
  const m = c.req.method.toUpperCase();     // the getter is the callee's receiver: still a read
  c.res = new Response(u + m);              // Context#res(Response) only: a plain assignment never reads
  c.req.routePath = "/x";                   // Request#routePath(string)
  c.count += 1;                             // Context#count() and Context#count(number)
  c.count++;                                // both again
  return c.req.routePath + c.res.status;    // Request#routePath(), Context#res(); status is the platform's
}

export function fresh(): Context {
  const l = new LoggedContext(Request.empty); // Request#static empty
  return l.req.url ? l : new Context(Request.empty); // LoggedContext#req: the override, not the base
}

export function metrics(g: Gauge): number {
  return g.value;                           // a LIBRARY getter: client -> library, only with the library staged
}
