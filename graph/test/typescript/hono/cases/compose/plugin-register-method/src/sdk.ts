import type { Hono } from 'hono'

export interface PluginInput {
  id: string
  register?(app: Hono): void
  menu?: { label: string; path: string }[]
}

export function definePlugin(input: PluginInput) {
  if (!input.id) throw new Error('definePlugin: id is required')
  return { ...input, defined: true }
}
