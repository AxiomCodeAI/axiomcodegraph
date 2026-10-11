import promisable from './promisable.js';
function op0Impl(coll, cb) { return cb(null, coll.length + 0); }
export default promisable(op0Impl, 2);
