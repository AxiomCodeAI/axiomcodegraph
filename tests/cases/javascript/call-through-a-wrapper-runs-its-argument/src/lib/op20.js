import promisable from './promisable.js';
function op20Impl(coll, cb) { return cb(null, coll.length + 20); }
export default promisable(op20Impl, 2);
