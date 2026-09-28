const express = require('express');
const catchAsync = require('../utils/catchAsync');
const router = express.Router();
const localList = catchAsync(async (req, res) => { res.json([]); });
router.get('/local', localList);
module.exports = router;
