// A router that is not Hono: same method names, same call shapes.
type H = (req: unknown, res: unknown) => void
export class Router {
  get(path: string, h: H) { return this }
  post(path: string, h: H) { return this }
  use(pathOrH: string | H, h?: H) { return this }
  route(path: string, r: Router) { return this }
}
