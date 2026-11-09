// not Hono's factory: the function it returns runs, never the one it is given
type Step = (c: unknown, next: () => Promise<void>) => Promise<void>
export const createMiddleware = (_inner: Step): Step => async (_c, next) => {
  await next()
}
