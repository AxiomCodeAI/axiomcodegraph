import { index } from './indexer.js';

function store(env) { return index(env); }
function enrich(env) { return store(env); }
function validate(env) { return enrich(env); }

export function ingest(env) { return validate(env); }
