// CONDITIONAL RETURN TYPES — the branches, never the test.
import { condPick, condGuarded } from '@tt/cond';

// Both branches declare `shared`, so a two-candidate set is the correct answer and
// the site is ANSWERED rather than blank.
export function callShared(tag: string): string {
  return condPick('k').shared(tag);        // -> CondAlpha.shared / CondBeta.shared
}

// The same through a conditional whose check names an interface. If the descent ever
// reads the CHECK child, `Marker` becomes a receiver type and `markerOnly` would
// appear as a candidate here.
export function callGuarded(tag: string): string {
  return condGuarded('k').shared(tag);     // -> CondAlpha.shared / CondBeta.shared
}
