export function leafC(): number {
  return 3;
}
export function ObjNamed(): string {
  return String(leafC());
}
export function ConciseNamed(): string {
  return "concise";
}
export default function ObjDefault(): string {
  return "default";
}
