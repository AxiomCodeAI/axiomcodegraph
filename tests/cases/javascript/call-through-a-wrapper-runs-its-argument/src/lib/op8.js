import promisable from './promisable.js';
function op8Impl(coll, cb) { return cb(null, coll.length + 8); }
export default promisable(op8Impl, 2);
