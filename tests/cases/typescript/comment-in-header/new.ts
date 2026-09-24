function Route(path: string) { return (t: any, k: string) => {}; }

export class Scanner {
  public async scanForModules( /* edited */
    root: string,
    depth: number,
  ): Promise<string[]> {
    return [root, String(depth)];
  }

  public resolve(name: string, strict: boolean): string {
    return name;
  }

  @Route('/b/:id')
  public handle(id: string): string {
    return id;
  }

  public scanUrl(url: string = 'http://x/*' /* why */): string { // trailing
    return url;
  }
}

export function run(s: Scanner) {
  s.scanForModules('.', 1);
  s.resolve('x');
  s.handle('1');
  s.scanUrl();
}
