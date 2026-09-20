'use strict';
const { process } = require('../src/pipeline');

it('trims every row', () => {
  expect(process([' a '])).toEqual(['a']);
});
