import promisable from './promisable.js';
function op18Impl(coll, cb) { return cb(null, coll.length + 18); }
export default promisable(op18Impl, 2);
