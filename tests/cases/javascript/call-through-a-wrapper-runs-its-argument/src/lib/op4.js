import promisable from './promisable.js';
function op4Impl(coll, cb) { return cb(null, coll.length + 4); }
export default promisable(op4Impl, 2);
