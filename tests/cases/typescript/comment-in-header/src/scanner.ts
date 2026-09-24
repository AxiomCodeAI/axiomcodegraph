function Route(path: string) { return (t: any, k: string) => {}; }

export class Scanner {
  public async scanForModules(
    root: string,
    depth: number,
  ): Promise<string[]> {
    return [root, String(depth)];
  }

  public resolve(name: string): string {
    return name;
  }

  @Route('/a/:id')
  public handle(id: string): string {
    return id;
  }

  public scanUrl(url: string = 'http://x/*'): string {
    return url;
  }
}

export function run(s: Scanner) {
  s.scanForModules('.', 1);
  s.resolve('x');
  s.handle('1');
  s.scanUrl();
}
