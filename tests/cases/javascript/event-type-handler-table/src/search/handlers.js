import { TOPICS } from '../pkg/topics.js';
import { index, drop } from './indexer.js';

export const handlers = {
  [TOPICS.CREATED]: async (env) => index(env),
  [TOPICS.DELETED]: async (env) => drop(env),
};
