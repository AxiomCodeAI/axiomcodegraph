// Every call below has one right declaration and `tsc` decides which. The comments name
// it for a reader and are never read by the harness.
import { render, pick, pluck, widen, Widget } from '@s/api';

const widget: Widget = { kind: 'widget' };
const box = { a: 1 };

export function useRender(): string[] {
  return [
    render('div'),          // SET 1 #0 — the GENERIC overload is the answer
    render('span'),         // SET 1 #0 — the generic one again
    render(widget),         // SET 1 #1 — the CONCRETE overload is the answer  NON-FIRST
  ];
}

export function usePick(): unknown[] {
  return [
    pick(box, box),         // SET 2 — same arity; only the constraint separates them
    pick(widget, widget),   // SET 2 — and the constraint is a type variable, so nothing does
  ];
}

export function usePluck(): unknown[] {
  return [
    pluck([widget], (w) => w.kind),   // SET 3 #0 — data-first
    pluck((w: Widget) => w.kind),     // SET 3 #1 — data-last                  NON-FIRST
  ];
}

export function useWiden(): unknown[] {
  return [
    widen('s'),             // SET 4 #0
    widen(1),               // SET 4 #1 — order must still reach a non-first   NON-FIRST
  ];
}
