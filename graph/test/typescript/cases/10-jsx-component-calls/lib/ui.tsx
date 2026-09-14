export type CardProps = { label: string };
export function Card(props: CardProps): string {
  return props.label;
}
export class Theme {
  color(): string {
    return "blue";
  }
}
