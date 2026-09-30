function record(env) { return [env.type, env.payload]; }
function onArchived(env) { return record(env); }

export const auditHandlers = {
  'doc.created'(env) { return record(env); },
  'doc.archived': onArchived,
};

export const LABELS = {
  'doc.created': ['created', (env) => record(env)],
};
