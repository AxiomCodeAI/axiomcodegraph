const core = require('../lib/core');
const shoutPlugin = require('../lib/plugins/shout');
core.extend(shoutPlugin);
test('shout', () => { expect(core().shout()).toBe('HEY'); });
