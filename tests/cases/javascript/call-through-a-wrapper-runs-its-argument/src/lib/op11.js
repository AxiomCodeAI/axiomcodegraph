import promisable from './promisable.js';
function op11Impl(coll, cb) { return cb(null, coll.length + 11); }
export default promisable(op11Impl, 2);
