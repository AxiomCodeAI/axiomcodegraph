// CONTROL: the nearest jsconfig.json maps nothing, so '@/check' does not resolve here
import { checkA } from '@/check';

export function probeC(request) {
  return checkA(request.token);
}
