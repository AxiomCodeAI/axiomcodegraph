// census: use_conditional_loop, combine_except (stress-6 oracle note; SPEC 3.3 dynamic chains, SPEC 3.1 except)
// Middleware come from a list chosen at run time (the tier's own, or one looked up in a registry, or none); each is registered as itself or wrapped in except(..) with a
// run-time exclusion list. Which middleware run, in which order, is decided at run time: every chain on the app is
// declared dynamic_middleware_list. Each tier's base path is a run-time value, so its routes are partial
// (dynamic_mount_prefix) and the dynamic chain is declared on the partial route too (its decidable chain keeps the
// tier's own first middleware). The except(..) call is a library middleware node at its call; its excluded
// paths are not literal, so its scope is also declared (dynamic_except).
import { Hono } from 'hono'
import { except } from 'hono/combine'
import type { MiddlewareHandler, Context } from 'hono'

type Guarded = { handler: MiddlewareHandler; except: (c: Context) => boolean }
type Entry = MiddlewareHandler | Guarded

const isGuarded = (m: Entry): m is Guarded => typeof m === 'object' && 'except' in m

// the tier's own list when it declares one, else one looked up by name in a run-time registry, else none
function tierEntries(tier: { name: string; entries?: Entry[] }, registry: Record<string, { default: Entry[] }>): Entry[] {
  if (tier.entries) return tier.entries
  const key = Object.keys(registry).find((k) => k.includes(`/${tier.name}/`))
  return key ? registry[key].default : []
}

type Tier = { name: string; basePath: string; entries?: Entry[] }

export function buildTier(tier: Tier, registry: Record<string, { default: Entry[] }>) {
  const app = new Hono().basePath(tier.basePath)
  app.use('/*', async (c, next) => { c.header('x-tier', '1'); await next() })
  for (const mw of tierEntries(tier, registry)) {
    app.use('/*', isGuarded(mw) ? except(mw.except, mw.handler) : mw)
  }
  app.get('/status', (c) => c.text('ok'))
  return app
}

declare const registry: Record<string, { default: Entry[] }>
declare const tiers: Tier[]

const root = new Hono()
root.get('/', (c) => c.text('root'))
for (const tier of tiers) root.route('/', buildTier(tier, registry))
export default root
