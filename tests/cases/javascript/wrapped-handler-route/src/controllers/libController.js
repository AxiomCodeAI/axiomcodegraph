const asyncHandler = require('express-async-handler');
const libList = asyncHandler(async (req, res) => { res.json([]); });
module.exports = { libList };
