// '@' from vite.config.js resolve.alias: resolved to src/utils/date.js
import { fmtDate } from '@/utils/date';
// '~shared' through fileURLToPath(new URL(...)): resolved to shared/fmt.js
import { fmtMoney } from '~shared/fmt';
// CONTROL: '@utils/date' is not '@' or '@/…', so the '@' alias does not apply
import { fmtDate as scoped } from '@utils/date';

export function render(order) {
  fmtMoney(order.total);
  scoped(order.at);
  return fmtDate(order.at);
}
