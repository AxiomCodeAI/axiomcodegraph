// A plugin module nothing imports: a loader the program does not show may mount its entry, at a prefix the program
// does not spell. Its handlers are routed nowhere else, so they are partial (unresolved_mount), never roots.
import { Hono } from 'hono'
import type { Plugin } from './magic-link'

function createLegacyExportPlugin(): Plugin {
  const legacy = new Hono()
  legacy.get('/csv', (c) => c.text('a,b'))
  return { name: 'legacy-export', routes: [{ path: '/legacy/export', handler: legacy }] }
}

export default createLegacyExportPlugin()
