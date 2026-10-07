import { index } from '@demo/search/indexer';

export function reindex(doc) { return index({ payload: doc }); }
