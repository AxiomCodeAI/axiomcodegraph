import request from 'supertest';

export async function healthOverHttp(): Promise<void> {
  await request({}).get('/healthz').expect(200);
}
