const express = require('express');
const { listAdmins, plainAdmins, adminCount } = require('../controllers/adminController');
const { arrowAdmins } = require('../controllers/arrowController');
const router = express.Router();
router.get('/admins', listAdmins);
router.get('/admins-plain', plainAdmins);
router.get('/admins-count', (req, res) => res.json(adminCount));
router.get('/admins-arrow', arrowAdmins);
module.exports = router;
