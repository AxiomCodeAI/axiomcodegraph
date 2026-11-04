export interface Configurable {
  thread: string
  ns: string
  id?: string
}
export interface Cfg {
  configurable: Configurable
}

// destructures its argument and hands back an object built from those names: called on its own result, every
// read of `thread` goes through the previous call's object (an evaluation cycle for a naive evaluator)
export class Saver {
  async put(config: Cfg, id: string): Promise<Cfg> {
    const { thread, ns } = config.configurable
    const next: Cfg = { configurable: { thread, ns, id } as Configurable }
    return next
  }
}

export async function resume(saver: Saver, config: Cfg) {
  const first = await saver.put(config, 'a')
  const second = await saver.put(first, 'b')
  return saver.put(second, 'c')
}
