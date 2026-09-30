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
