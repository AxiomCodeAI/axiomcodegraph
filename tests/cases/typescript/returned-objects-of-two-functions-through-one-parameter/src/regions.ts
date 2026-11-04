import { Hono } from 'hono'
import { orderModule } from './modules'

function attachRegion(host: Hono, mod: { http: Hono; name: string }) {
  const { http } = mod
  host.route('/', http)
  return host
}

const east = attachRegion(new Hono(), orderModule())
const west = attachRegion(new Hono(), orderModule())

const regions = new Hono()
regions.route('/east', east)
regions.route('/west', west)

export default regions
