// census: neg_verb_literal_nonhono (violation hono-2-12)
// fetch to another host's /health is not a request to this app's GET /health.
import { Hono } from 'hono'

class ExternalApi {
  #baseUrl = 'https://api.example.com'
  async ping() {
    return fetch(`${this.#baseUrl}/health`)
  }
}
export const external = new ExternalApi()

const app = new Hono()
app.get('/health', (c) => c.text('ok'))

export default app
