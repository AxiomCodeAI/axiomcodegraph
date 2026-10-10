import promisable from './promisable.js';
function op19Impl(coll, cb) { return cb(null, coll.length + 19); }
export default promisable(op19Impl, 2);
