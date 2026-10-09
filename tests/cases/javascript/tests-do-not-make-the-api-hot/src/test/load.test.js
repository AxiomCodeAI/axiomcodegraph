const { load } = require('../lib/loader');
test('alpha', () => { expect(load('alpha')).toBe('codec:alpha'); });
