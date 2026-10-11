import promisable from './promisable.js';
function op3Impl(coll, cb) { return cb(null, coll.length + 3); }
export default promisable(op3Impl, 2);
