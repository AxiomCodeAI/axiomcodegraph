import promisable from './promisable.js';
function op10Impl(coll, cb) { return cb(null, coll.length + 10); }
export default promisable(op10Impl, 2);
