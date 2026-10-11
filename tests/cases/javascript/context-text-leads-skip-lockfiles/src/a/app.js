import { readFileSync } from 'node:fs';

export function debug(config) {
  return config.verbose === true;
}

export function optional(value, fallback) {
  return value === undefined ? fallback : value;
}

export function createApp(config) {
  const routes = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url), 'utf8'));
  return { routes, verbose: debug(config), port: optional(config.port, 8080) };
}
