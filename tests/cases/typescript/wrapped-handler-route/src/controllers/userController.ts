import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
export const listUsers = catchAsync(async (req: Request, res: Response) => { res.json([]); });
export async function getUser(req: Request, res: Response) { res.json({}); }
export const userOptions = { strict: true };
