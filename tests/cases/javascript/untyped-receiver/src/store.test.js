import request from 'supertest';
import * as grpc from '@grpc/grpc-js';
import { test } from 'node:test';

test('health over http', async () => {
  await request({}).get('/healthz').expect(200);
  const md = new grpc.Metadata();
  md.get('k');
});
