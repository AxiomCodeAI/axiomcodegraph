import { drawShapes } from '../lib/render/painter'
import { openMenu } from './tools/menu'
export function start(): string {
  return drawShapes(['circle', 'square']) + openMenu()
}

export class SketchyApp {
  run(): string {
    return start()
  }
}
