import express from 'express';

export function requireAuth(tokens) {
  return function checkBearer(req, res, next) {
    const token = req.get('authorization');
    if (!token) return next(new Error('bearer token required'));
    req.user = tokens.verify(token);
    next();
  };
}

export function createForwarder(target) {
  return function forwardUpstream(req, res) {
    relayBody(target, req, res);
  };
}

function relayBody(target, req, res) {
  res.send({ target, path: req.path });
}

function recordHit(req, res, next) {
  req.seen = true;
  next();
}

function makeThrottle() {
  return function throttleRequest(req, res, next) {
    next();
  };
}

function lastResort(req, res) {
  res.status(404).end();
}

function renderStatus(req, res) {
  res.send('ok');
}

function renderVersion(req, res) {
  res.send('1');
}

export function gatewayRouter(tokens, audit) {
  const router = express.Router();
  const throttle = makeThrottle();
  audit.use(recordHit);
  router.use(requireAuth(tokens), throttle);
  router.use('/docs', createForwarder('http://docs.internal'));
  router.use(lastResort);
  return router;
}

export function statusRouter() {
  const router = express.Router();
  router.get('/status', renderStatus);
  router.get('/version', renderVersion);
  return router;
}
