export class Response {
  render() { return 'ok'; }
  close() {}
}

export class Builder {
  step() { return this; }
  done() { return new Response(); }
}

/** @returns {Response} */
export function makeResponse(req) { return build(req); }

export function makeBuilder(req) { return new Builder(); }

export function untyped(req) { return req; }

export async function fetchResponse(req) { return new Response(); }

function build(req) { return new Response(); }
