import { mergePath } from './utils/url'

export class App {
  base = '/api'
  route(path: string): string {
    return mergePath(this.base, path)
  }
}
