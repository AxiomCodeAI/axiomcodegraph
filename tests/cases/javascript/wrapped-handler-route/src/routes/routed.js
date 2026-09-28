const express = require('express');
const { listReports } = require('../controllers/report.controller');
const { plainAdmins } = require('../controllers/adminController');
const router = express.Router();
router.route('/reports').get(listReports);
router.route('/both').get(plainAdmins).post(plainAdmins);
module.exports = router;
