import { makeTable } from './makeTable'

// called while this module is IMPORTED, not from any function. The graph records the module body as the
// caller, so `config.<module>` is the only thing standing between makeTable and every importer of this file.
export const booleanAttrs = makeTable('checked,disabled,readonly')
