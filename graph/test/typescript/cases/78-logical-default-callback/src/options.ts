// AN OPTIONAL CALLBACK WITH A DEFAULT. `const onError = options.onError || defaultOnError` is how a
// TypeScript API takes an optional callback: the property if the caller supplied one, a module default
// otherwise. The variable is typed by the compiler as the property's function type, so a call through it
// names that type's call signature, exactly as the undefaulted binding (`plain`) does.
export type ErrorHandler = (message: string) => void
export type Formatter = (value: number, digits: number) => string

export interface Options {
  onError?: ErrorHandler
  format?: Formatter
  tags?: string[]
}

export function defaultOnError(message: string): void {
  console.error(message)
}

const defaultFormat = (value: number, digits: number): string => value.toFixed(digits)

export function withOr(options: Options): void {
  const onError = options.onError || defaultOnError
  onError('or')
}

export function withNullish(options: Options): string {
  const format = options.format ?? defaultFormat
  return format(1, 2)
}

// A reassigned `let` keeps the same shape: the value is still one operand or the other.
export function withLet(options: Options): void {
  let report = options.onError ?? defaultOnError
  report('let')
}

// CONTROL: the identical binding with no default. Already resolved; must not change.
export function plain(options: Options): void {
  const onError = options.onError
  if (onError) onError('plain')
}

// CONTROL: an array defaulted with `|| []`, then mapped. The receiver stays the property's array type;
// the default must not add the empty array literal's type to it.
export function tagList(options: Options): string[] {
  const tags = options.tags || []
  return tags.map((t) => t.toUpperCase())
}

// CONTROL: `&&` yields its RIGHT operand, so a guarded handler keeps the handler's signature and a
// boolean left operand contributes nothing.
export function guarded(enabled: boolean, options: Options): void {
  const handler = enabled && options.onError
  if (handler) handler('guarded')
}
