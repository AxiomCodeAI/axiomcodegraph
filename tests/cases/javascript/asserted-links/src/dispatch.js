import * as handlers from './handlers';
// a document is a plain object

export function dispatch(event, doc) {
  const fn = (handlers)[event];
  return fn(doc);
}

export function runTable(table, key, doc) {
  return table[key](doc);
}

export function purge(doc) {
  const fn = (handlers)['on' + 'Purge'];
  return fn(doc);
}

export function saveAndAudit(doc) {
  return handlers.audit(doc);
}

export function reload(doc) {
  const fn = (handlers)['on' + 'Load'];
  return fn(doc);
}
