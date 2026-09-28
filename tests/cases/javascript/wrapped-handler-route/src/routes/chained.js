const express = require('express');
const adminController = require('../controllers/adminController');
const auth = () => (req, res, next) => next();
const router = express.Router();
router
  .route('/admins-c')
  .get(auth(), adminController.listAdmins);
module.exports = router;
