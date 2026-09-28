const catchAsync = require('../utils/catchAsync');
const listAdmins = catchAsync(async (req, res) => { res.json([]); });
async function plainAdmins(req, res) { res.json([]); }
const adminCount = 3;
module.exports = { listAdmins, plainAdmins, adminCount };
