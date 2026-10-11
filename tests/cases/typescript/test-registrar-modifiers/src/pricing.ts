export function total(items: number[]): number {
  return items.reduce((a, b) => a + b, 0)
}

export function discount(amount: number): number {
  return amount > 100 ? amount * 0.9 : amount
}

export function shipping(weight: number): number {
  return weight * 2
}

export function rounding(value: number): number {
  return Math.round(value * 100) / 100
}

export function tax(amount: number): number {
  return amount * 0.2
}

export function audit(amount: number): number {
  return amount
}

export function settle(fn: () => number): number {
  return fn()
}

export function late(): number {
  return 1
}

export function packaging(count: number): number {
  return count * 3
}
