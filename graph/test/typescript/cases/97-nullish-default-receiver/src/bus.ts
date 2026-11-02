// `a ?? b` and `a || b` carry the left operand's type. A defaulted lookup is the
// ordinary way to read-or-create an entry, and the receiver after the default had no
// type.
type Listener = (payload: unknown) => void;

export class Bus {
  private readonly listeners = new Map<string, Listener[]>();
  private readonly labels = new Map<string, string>();

  on(event: string, l: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(l);
    this.listeners.set(event, list);
  }
  direct(event: string, l: Listener): number {
    return (this.listeners.get(event) ?? []).push(l);
  }
  label(event: string): string {
    return (this.labels.get(event) || "none").trim();
  }

  // A left side that is never nullish carries its type through the default too.
  nonNullable(xs: Listener[], l: Listener): number {
    return (xs ?? []).push(l);
  }

  // controls: an annotated default resolved before and must not change, and an untyped
  // left side does not borrow the right side's type.
  annotated(event: string, l: Listener): number {
    const list: Listener[] = this.listeners.get(event) ?? [];
    return list.push(l);
  }
  untyped(x: any, l: Listener): void {
    const list = x ?? [];
    list.push(l);
  }
}
