'use strict';
// the dependency is declared and NOT installed; its IR is staged with --library
const { createApp } = require('kit');
const { alpha } = require('kit/feat/alpha');
const { beta } = require('kit/feat/beta');
const { gamma } = require('kit/mjs/gamma');
const internal = require('kit/internal/secret');
const nested = require('kit/feat/deep/none');
function main() { createApp().start(); alpha(); beta(); gamma(); internal.secret(); nested.x(); }
main();
