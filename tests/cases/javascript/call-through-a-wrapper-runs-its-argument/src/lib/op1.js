import promisable from './promisable.js';
function op1Impl(coll, cb) { return cb(null, coll.length + 1); }
export default promisable(op1Impl, 2);
