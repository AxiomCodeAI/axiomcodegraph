type Doc = Record<string, unknown>;

export function onSave(doc: Doc): Doc {
  return audit(doc);
}

export function onLoad(doc: Doc): Doc {
  return doc;
}

export function onPurge(doc: Doc): Doc {
  return doc;
}

export function audit(doc: Doc): Doc {
  doc.audited = true;
  return doc;
}
