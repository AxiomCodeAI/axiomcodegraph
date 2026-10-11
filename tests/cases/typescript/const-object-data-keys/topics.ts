export const TOPICS = Object.freeze({
  CREATED: 'doc.created',
  DELETED: 'doc.deleted',
});

export const QUEUES = {
  CREATED: 'queue.created',
} as const;

export const LIMITS = {
  nested: { depth: 3 },
};

export const HANDLERS = Object.freeze({
  run: (id: string) => id.length,
});

export const helpers = {
  shout: (s: string) => s.toUpperCase(),
};
