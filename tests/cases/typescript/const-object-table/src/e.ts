import { TOKENS } from './k';

export class Relay {}

export function relayToken() {
  return TOKENS.Relay;
}

export function makeRelay() {
  return new Relay();
}
