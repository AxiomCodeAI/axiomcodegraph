// SvelteKit's $lib, mapped by the generated .svelte-kit/tsconfig.json that a checkout lacks
import * as api from '$lib/api.js';
import { post } from '$lib/api';

export function load({ params }) {
  return api.get(params.slug);
}

export function save(body) {
  return post('/save', body);
}
