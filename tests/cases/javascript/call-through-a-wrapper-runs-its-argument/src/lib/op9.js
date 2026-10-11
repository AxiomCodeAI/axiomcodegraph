import promisable from './promisable.js';
function op9Impl(coll, cb) { return cb(null, coll.length + 9); }
export default promisable(op9Impl, 2);
