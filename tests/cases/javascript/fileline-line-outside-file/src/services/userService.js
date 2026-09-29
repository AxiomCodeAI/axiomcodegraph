const db = require('../db');
function getUser(id) { return db.find(id); }
module.exports = { getUser };
// last line
