import promisable from './promisable.js';
function op5Impl(coll, cb) { return cb(null, coll.length + 5); }
export default promisable(op5Impl, 2);
