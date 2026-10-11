import promisable from './promisable.js';
function op12Impl(coll, cb) { return cb(null, coll.length + 12); }
export default promisable(op12Impl, 2);
