import promisable from './promisable.js';
function op2Impl(coll, cb) { return cb(null, coll.length + 2); }
export default promisable(op2Impl, 2);
