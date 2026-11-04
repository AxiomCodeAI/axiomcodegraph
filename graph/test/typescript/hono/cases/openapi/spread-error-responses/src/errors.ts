import { z } from 'zod'

const errorBody = (code: string) => z.object({ code: z.literal(code), message: z.string() })

export const errorResponses = {
  400: {
    description: 'bad request',
    content: { 'application/json': { schema: errorBody('BAD_REQUEST') } },
  },
  403: {
    description: 'forbidden',
    content: { 'application/json': { schema: errorBody('FORBIDDEN') } },
  },
}
