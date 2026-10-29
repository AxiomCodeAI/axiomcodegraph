import { Hono } from 'hono'

export function newApp() {
  return new Hono()
}
