import { Hono } from 'hono'

export class Routes {
  static initHono(base: string) {
    return new Hono().basePath(base)
  }
}
