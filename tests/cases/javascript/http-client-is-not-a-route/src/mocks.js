import { http } from 'msw';

const env = { API_URL: 'http://localhost' };

function registerUser(info) { return info; }

export const handlers = [
  http.post(`${env.API_URL}/auth/register`, async ({ request }) => registerUser(await request.json())),
];
