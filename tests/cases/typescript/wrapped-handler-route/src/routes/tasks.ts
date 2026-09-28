import { FastifyInstance } from 'fastify';
import { TaskSchema, CreateTaskSchema, UpdateTaskSchema } from '../schemas/task';
export default async function plugin(fastify: FastifyInstance) {
  fastify.get('/:id', { schema: { response: { 200: TaskSchema } } }, async function getTask(request: any) {
    return { id: request.params.id };
  });
  fastify.post('/', { schema: { body: CreateTaskSchema, response: { 201: TaskSchema } } }, async (request: any) => request.body);
  fastify.patch(
    '/:id',
    {
      schema: {
        body: UpdateTaskSchema,
        response: { 200: TaskSchema }
      }
    },
    async function updateTask(request: any) {
      return request.body;
    }
  );
}
