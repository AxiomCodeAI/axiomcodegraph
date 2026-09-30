import { create, remove } from './app';

describe('bus', () => {
  it('creates', () => {
    create();
  });
  it('removes', () => {
    remove();
  });
});
