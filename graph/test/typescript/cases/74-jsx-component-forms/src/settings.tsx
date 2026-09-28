export function saveSettings(): number {
  return 1;
}

export default function Settings(): string {
  return String(saveSettings());
}
