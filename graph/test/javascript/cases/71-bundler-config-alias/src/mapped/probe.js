// CONTROL: the nearest jsconfig.json maps '@/*' itself, and that mapping wins over vite.config.js
import { fmtDate } from '@/date';

export function probe(d) {
  return fmtDate(d);
}
