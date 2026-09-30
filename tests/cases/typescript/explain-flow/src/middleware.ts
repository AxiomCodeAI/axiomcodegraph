type Next = (err?: unknown) => void;

export function requireSession(sessions: { check(token: string): string }) {
  return function checkSession(req: any, res: any, next: Next) {
    req.user = sessions.check(req.get('cookie'));
    next();
  };
}

export function createRelay(target: string) {
  return function relayUpstream(req: any, res: any) {
    res.send(target);
  };
}

export function mountSite(app: any, sessions: { check(token: string): string }) {
  app.use(requireSession(sessions));
  app.use('/site', createRelay('http://site.internal'));
}
