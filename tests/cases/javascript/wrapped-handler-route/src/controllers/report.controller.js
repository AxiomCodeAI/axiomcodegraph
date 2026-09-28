const catchAsync = require('../utils/catchAsync');
const listReports = catchAsync(async (req, res) => { res.json([]); });
module.exports = { listReports };
