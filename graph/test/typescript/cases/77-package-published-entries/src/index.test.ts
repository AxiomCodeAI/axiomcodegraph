// The project's own test imports the entry, which is what used to hide it: neither
// index.ts nor plugins/logger.ts is an unimported module.
import { useStore } from './index';
import { logger } from './plugins/logger';

export const subjects = [useStore, logger];
