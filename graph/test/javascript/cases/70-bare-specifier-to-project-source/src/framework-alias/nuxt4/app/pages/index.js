// Nuxt 4: the source dir is app/, and the root config only references the generated ones
import { formatDate } from '~/utils/date';

export function page(d) {
  return formatDate(d);
}
