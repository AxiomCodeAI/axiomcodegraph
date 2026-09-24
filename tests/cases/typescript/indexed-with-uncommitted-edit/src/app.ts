export type Options = {
  mode: 'strict' | 'loose'
}

export function a(options: Options): number {
  return options.mode === 'strict' ? 1 : 0
}

export function b(): number {
  return 2
}
