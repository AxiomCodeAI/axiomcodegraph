const express = require('express');
const adminController = require('../controllers/adminController');
const auth = () => (req, res, next) => next();
const router = express.Router();
router.route('/admins-q').get(auth(), adminController.listAdmins);
const limit = adminController.adminCount;
module.exports = { router, limit };
