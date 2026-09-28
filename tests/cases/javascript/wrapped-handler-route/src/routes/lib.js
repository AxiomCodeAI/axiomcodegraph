const express = require('express');
const { libList } = require('../controllers/libController');
const { plainAdmins } = require('../controllers/adminController');
const router = express.Router();
router.get('/lib', libList);
router.route('/lib-mixed').post(libList, plainAdmins);
module.exports = router;
