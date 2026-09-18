import Component from './component.js';
export default class Button extends Component {
  constructor(player) { super(player); this.kind = 'button'; }
  createEl() { return 'button'; }
  dispose() { return 'button-disposed'; }
}
