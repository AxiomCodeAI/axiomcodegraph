import promisable from './promisable.js';
function op17Impl(coll, cb) { return cb(null, coll.length + 17); }
export default promisable(op17Impl, 2);
