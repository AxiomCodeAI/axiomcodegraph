import promisable from './promisable.js';
function op23Impl(coll, cb) { return cb(null, coll.length + 23); }
export default promisable(op23Impl, 2);
