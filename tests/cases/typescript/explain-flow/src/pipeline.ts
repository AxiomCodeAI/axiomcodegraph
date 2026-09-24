// A small job runner: Pipeline.run is the front door, the rest is its machinery.
export interface Job { readonly name: string; readonly text: string }

export class Tokenizer {
  tokenize(text: string): string[] {
    return text.split(' ')
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
