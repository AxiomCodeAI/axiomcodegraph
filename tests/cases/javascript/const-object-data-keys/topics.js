export const TOPICS = Object.freeze({
  CREATED: 'doc.created',
  DELETED: 'doc.deleted',
});

export const LIMITS = {
  page: 50,
  nested: { depth: 3 },
};

export const QUEUES = Object.freeze({
  CREATED: 'queue.created',
});

export const helpers = {
  shout: (s) => s.toUpperCase(),
};

export const HANDLERS = Object.freeze({
  run: (job) => job.id,
});
