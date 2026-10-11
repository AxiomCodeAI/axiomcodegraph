import { Svc, standalone } from './svc';

export function main(): number {
  standalone();
  return new Svc().run();
}
