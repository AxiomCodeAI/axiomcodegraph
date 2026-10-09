import promisable from './promisable.js';
function op13Impl(coll, cb) { return cb(null, coll.length + 13); }
export default promisable(op13Impl, 2);
