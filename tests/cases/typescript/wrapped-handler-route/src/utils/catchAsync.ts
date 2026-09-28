export type Handler = (req: any, res: any, next: any) => Promise<void> | void;
export const catchAsync = (fn: Handler): Handler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
