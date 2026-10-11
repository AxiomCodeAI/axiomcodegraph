// Nuxt's ~ and @, mapped by the generated .nuxt/tsconfig.json that a checkout lacks
import { formatPrice } from '~/utils/price';
import { formatPrice as viaAt } from '@/utils/price';

export default function handler() {
  return formatPrice(1) + viaAt(2);
}
