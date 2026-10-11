import promisable from './promisable.js';
function op6Impl(coll, cb) { return cb(null, coll.length + 6); }
export default promisable(op6Impl, 2);
