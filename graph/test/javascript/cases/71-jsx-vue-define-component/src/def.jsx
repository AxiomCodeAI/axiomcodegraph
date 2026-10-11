import { defineComponent } from "vue";

export function defLeaf() { return 6; }

// The module's default export, rendered through a default import.
export default defineComponent({ setup() { defLeaf(); return () => "d"; } });
