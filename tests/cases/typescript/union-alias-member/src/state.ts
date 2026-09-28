export interface ObjectState { kind: 'object'; value: object }
export interface MapState { kind: 'map'; value: Map<string, unknown> }
export interface SetState { kind: 'set'; value: Set<unknown> }

// the union the consumers write; none of them names a member
export type DraftState = ObjectState | MapState | SetState

// a second hop: an alias over the alias
export type AnyState = DraftState | null

// CONTROL: an alias whose members are unrelated to MapState
export type Plain = { n: number } | string
