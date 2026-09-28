import express from 'express';
import { listUsers, getUser, userOptions } from '../controllers/userController';
const router = express.Router();
router.get('/users', listUsers);
router.get('/users/:id', getUser);
router.post('/users', userOptions, listUsers);
export default router;
