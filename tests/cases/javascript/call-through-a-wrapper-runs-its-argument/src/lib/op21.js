import promisable from './promisable.js';
function op21Impl(coll, cb) { return cb(null, coll.length + 21); }
export default promisable(op21Impl, 2);
