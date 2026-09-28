const { shout } = require('../lib/text');
const { sample } = require('./helpers');

describe('shout', () => {
  it('adds a bang', () => {
    expect(shout(sample())).toBe('HI!');
  });
});
