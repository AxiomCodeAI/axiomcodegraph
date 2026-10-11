import { TOPICS } from '@demo/topics';
import { index } from './indexer.js';

export const handlers = {
  [TOPICS.CREATED]: async (env) => index(env),
};
