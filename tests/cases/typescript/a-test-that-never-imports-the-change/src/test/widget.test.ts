import { run } from '../src/runner'
import Widget from './Widget.vue'

test('a component the reading cannot open', () => {
  expect(run(Widget.handler, 1)).toBe(1)
})
