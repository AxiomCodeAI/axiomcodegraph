import promisable from './promisable.js';
function op22Impl(coll, cb) { return cb(null, coll.length + 22); }
export default promisable(op22Impl, 2);
