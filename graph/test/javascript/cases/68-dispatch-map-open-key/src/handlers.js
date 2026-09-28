// A dispatch table exported as an object literal: reducers, command maps and CLI
// dispatch are written this way, and the key that picks the entry is data.
function addItem(state, p) { return [...state, p]; }
function removeItem(state, p) { return state.filter((x) => x !== p); }
export const handlers = { ADD: addItem, REMOVE: removeItem, CLEAR: () => [], LIMIT: 10 };

function runBuild(argv) { return argv; }
function runServe(argv) { return argv; }
export const cli = { commands: { build: runBuild, serve: runServe } };
