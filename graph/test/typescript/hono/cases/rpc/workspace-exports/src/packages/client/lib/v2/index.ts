import { hc } from 'hono/client'
import type { AppType } from '@scope/server'

export const client = hc<AppType>('http://localhost')
