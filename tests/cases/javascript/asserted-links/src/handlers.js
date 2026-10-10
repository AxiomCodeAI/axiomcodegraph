// a document is a plain object

export function onSave(doc) {
  return audit(doc);
}

export function onLoad(doc) {
  return doc;
}

export function onPurge(doc) {
  return audit(doc);
}

export function audit(doc) {
  doc.audited = true;
  return doc;
}
