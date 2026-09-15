import Button from './button.js';
import Component from './component.js';
// A stale @extends tag naming the grandparent (#656): the clause is the program.
/**
 * @extends Component
 */
class SeekToLive extends Button {
  constructor(player) { super(player); }
  createEl() { const el = super.createEl(); return el + '!'; }
  dispose() { this.createEl(); return super.dispose(); }
}
// The control: tag and clause agree.
/**
 * @extends Button
 */
class Agreeing extends Button {
  constructor(player) { super(player); }
  createEl() { return super.createEl() + '?'; }
}
export function run() { const s = new SeekToLive(1); const a = new Agreeing(2); return s.createEl() + s.dispose() + a.createEl(); }
