import promisable from './promisable.js';
function op16Impl(coll, cb) { return cb(null, coll.length + 16); }
export default promisable(op16Impl, 2);
