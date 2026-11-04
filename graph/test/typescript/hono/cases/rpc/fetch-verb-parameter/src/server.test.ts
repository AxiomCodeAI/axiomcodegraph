import app from './server'

declare function it(name: string, fn: () => unknown): void

async function hit(path: string, init?: RequestInit) {
  return app.request(path, init)
}

it('reads a skill', async () => {
  await hit('/api/skills/1')
})

declare const recorded: string

it('replays a recorded request', async () => {
  const init = JSON.parse(recorded) as RequestInit
  await hit('/api/skills/2', init)
})
