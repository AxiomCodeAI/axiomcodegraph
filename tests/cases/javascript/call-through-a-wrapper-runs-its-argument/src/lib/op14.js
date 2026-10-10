import promisable from './promisable.js';
function op14Impl(coll, cb) { return cb(null, coll.length + 14); }
export default promisable(op14Impl, 2);
