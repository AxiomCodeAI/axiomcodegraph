// The slice of the Deno runtime's global API a Hono-on-Deno fixture uses, so the oracle can typecheck it
// under the TypeScript compiler (no Deno toolchain is involved; the shapes follow Deno's own declarations).
declare namespace Deno {
  type ServeHandler = (request: Request, info?: unknown) => Response | Promise<Response>
  function serve(handler: ServeHandler): unknown
  function serve(options: { port?: number; hostname?: string }, handler: ServeHandler): unknown
  const env: { get(key: string): string | undefined }
}
