export default class Component {
  constructor(player) { this.player = player; }
  createEl() { return 'component'; }
  dispose() { return 'disposed'; }
}
