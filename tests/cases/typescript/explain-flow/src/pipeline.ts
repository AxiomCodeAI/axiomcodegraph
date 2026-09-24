// A small job runner: Pipeline.run is the front door, the rest is its machinery.
export interface Job { readonly name: string; readonly text: string }

// a deep chain of helpers under the FIRST call: a depth-first flow spent its whole budget here
export function helper0(x: string): string { return helper1(x) }
export function helper1(x: string): string { return helper2(x) }
export function helper2(x: string): string { return helper3(x) }
export function helper3(x: string): string { return helper4(x) }
export function helper4(x: string): string { return helper5(x) }
export function helper5(x: string): string { return helper6(x) }
export function helper6(x: string): string { return helper7(x) }
export function helper7(x: string): string { return helper8(x) }
export function helper8(x: string): string { return helper9(x) }
export function helper9(x: string): string { return helper10(x) }
export function helper10(x: string): string { return helper11(x) }
export function helper11(x: string): string { return helper12(x) }
export function helper12(x: string): string { return helper13(x) }
export function helper13(x: string): string { return helper14(x) }
export function helper14(x: string): string { return helper15(x) }
export function helper15(x: string): string { return helper16(x) }
export function helper16(x: string): string { return helper17(x) }
export function helper17(x: string): string { return helper18(x) }
export function helper18(x: string): string { return helper19(x) }
export function helper19(x: string): string { return helper20(x) }
export function helper20(x: string): string { return helper21(x) }
export function helper21(x: string): string { return helper22(x) }
export function helper22(x: string): string { return helper23(x) }
export function helper23(x: string): string { return x }

export class Tokenizer {
  tokenize(text: string): string[] {
    return helper0(text).split(' ')
  }
}

export class Planner {
  plan(tokens: string[]): string[] {
    return tokens.map((t) => t.toUpperCase())
  }
}

export class Driver {
  dispatch(step: string): void {
    console.log(step)
  }
}

export class Executor {
  execute(steps: string[], hook: (s: string) => void): number {
    // an untyped value: the graph cannot say which `dispatch` this is, so the flow must mark it, not end at it
    const driver: any = (globalThis as any).driver
    for (const s of steps) { hook(s); driver.dispatch(s) }
    driver.items()
    return steps.length
  }
}

export class Pipeline {
  private readonly tokenizer = new Tokenizer()
  private readonly planner = new Planner()
  private readonly executor = new Executor()
  private readonly registry: Record<string, (s: string) => void> = {}

  run(job: Job): number {
    const tokens = this.tokenizer.tokenize(job.text)
    const steps = this.planner.plan(tokens)
    const hook = this.registry[job.name]
    return this.executor.execute(steps, hook)
  }

  log(message: string): void {
    console.log(message)
  }
}

export function main(): number {
  return new Pipeline().run({ name: 'a', text: 'x y' })
}
