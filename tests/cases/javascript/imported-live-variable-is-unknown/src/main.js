import { handler, hook, fixed, ready } from './hub.js';
import * as hub from './hub.js';
import { relayed } from './barrel.js';
import * as barrel from './barrel.js';
export function fireImported() { return handler(); }
export function fireNs() { return hub.handler(); }
export function fireSpecifier() { return hook(); }
export function fireRelayed() { return relayed(); }
export function fireBarrelNs() { return barrel.handler(); }
// controls: an export nothing reassigns, and one holding a function
export function fireFixed() { return fixed(); }
export function fireReady() { return ready(); }
export function fireNsFixed() { return hub.fixed(); }
