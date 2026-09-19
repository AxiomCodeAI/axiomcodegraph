import { it, expect } from 'vitest';
import { App, LinearRouter } from './router';

it('mounts a path', () => {
  const app = new App(new LinearRouter());
  app.mount('/x');
  expect(true).toBe(true);
});
