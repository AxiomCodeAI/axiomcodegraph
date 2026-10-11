import { start } from '../src/index.js';

// a helper the tests call, named like a test: no runner collects it
export function testApp() {
  const app = start();
  return app({ type: 'doc.created', payload: 1 });
}
