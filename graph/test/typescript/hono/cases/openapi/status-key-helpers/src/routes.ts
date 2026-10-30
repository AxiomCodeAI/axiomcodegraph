import { createRoute, z } from '@hono/zod-openapi'
import * as Status from './status'
import { jsonBody, jsonBodyRequired } from './helpers'

const Ticket = z.object({ id: z.string(), title: z.string() })
const Missing = z.object({ message: z.string() })
const TicketInput = z.object({ title: z.string() })

export const getTicket = createRoute({
  path: '/tickets/{id}',
  method: 'get',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    [Status.OK]: jsonBody(Ticket, 'the ticket'),
    [Status.NOT_FOUND]: jsonBody(Missing, 'no such ticket'),
  },
})

export const createTicket = createRoute({
  path: '/tickets',
  method: 'post',
  request: { body: jsonBodyRequired(TicketInput, 'a new ticket') },
  responses: {
    [Status.CREATED]: jsonBody(Ticket, 'created'),
  },
})
