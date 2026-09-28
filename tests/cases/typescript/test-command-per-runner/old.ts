export function total(prices: number[]): number {
  let sum = 0;
  for (const p of prices) sum += p;
  return sum;
}
