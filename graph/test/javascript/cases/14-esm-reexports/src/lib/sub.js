import { Base } from './base.js';
import * as B from './base.js';
export default class extends Base { id() { return 'sub:' + super.id(); } }
export class ViaNs extends B.Base { own() { return this.id(); } }
export class ViaDefault extends (await import('./base.js')).Base { }
