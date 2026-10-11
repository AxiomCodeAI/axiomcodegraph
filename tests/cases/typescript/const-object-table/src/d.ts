import { ROUTES } from './k';

function Route(_path: string) {
  return (_target: object, _key: string) => undefined;
}

export class Handlers {
  @Route(ROUTES.one)
  one() {
    return 1;
  }
}

function Inject(_token: string) {
  return (_target: object, _key: string | undefined, _index: number) => undefined;
}

export class Consumer {
  constructor(@Inject(ROUTES.list) private readonly path: string) {}
}

export class Publisher {
  constructor(private readonly path: string = ROUTES.list) {}
}

export function withLookup(lookup = () => ROUTES.list) {
  return lookup();
}
