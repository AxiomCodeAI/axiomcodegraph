export class Response {
  render(): string { return 'ok'; }
  close(): void {}
}

export class Builder {
  step(): Builder { return this; }
  done(): Response { return new Response(); }
}

export function makeResponse(req: unknown): Response { return new Response(); }
export function maybeResponse(req: unknown): Response | undefined { return new Response(); }
export async function fetchResponse(req: unknown): Promise<Response> { return new Response(); }
export function makeBuilder(req: unknown) { return new Builder(); }
export function untyped(req: unknown) { return req; }
export function many(req: unknown): Response[] { return [new Response()]; }
