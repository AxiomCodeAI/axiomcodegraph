export function hitTest(x: number): number { return x * 2 }
export function persist(id: string): string { return id.trim() }
export function startClock(): number { return Date.now() }
export function stopClock(): number { return 0 }
export function onSave(): string { return "saved" }
export function drawRow(i: number): string { return String(i) }
export function measure(n: number): number { return n + 1 }
