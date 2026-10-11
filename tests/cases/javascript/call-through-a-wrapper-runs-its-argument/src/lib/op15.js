import promisable from './promisable.js';
function op15Impl(coll, cb) { return cb(null, coll.length + 15); }
export default promisable(op15Impl, 2);
