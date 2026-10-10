import promisable from './promisable.js';
function op7Impl(coll, cb) { return cb(null, coll.length + 7); }
export default promisable(op7Impl, 2);
