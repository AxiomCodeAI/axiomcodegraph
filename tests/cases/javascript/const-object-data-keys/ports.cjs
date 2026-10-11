'use strict';
const OFFSETS = Object.freeze({
  web: 0,
  api: 1,
});

function portFor(name) {
  return 1000 + OFFSETS[name];
}

function apiPort() {
  return 1000 + OFFSETS.api;
}

exports.OFFSETS = OFFSETS;
exports.portFor = portFor;
exports.apiPort = apiPort;
