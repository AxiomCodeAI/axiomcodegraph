import * as handlers from './handlers';
type Doc = Record<string, unknown>;

export function dispatch(event: string, doc: Doc): Doc {
  const fn = (handlers as any)[event];
  return fn(doc);
}

export function runTable(table: Record<string, (d: Doc) => Doc>, key: string, doc: Doc): Doc {
  return table[key](doc);
}

export function purge(doc: Doc): Doc {
  const fn = (handlers as any)['on' + 'Purge'];
  return fn(doc);
}

export function saveAndAudit(doc: Doc): Doc {
  return handlers.audit(doc);
}
