function fillRows(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

export function seedRows(n: number): number[] {
  return fillRows(n)
}
