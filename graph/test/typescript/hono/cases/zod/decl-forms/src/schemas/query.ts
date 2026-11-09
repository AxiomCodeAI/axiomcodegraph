import { z } from 'zod'

export const Paging = z.object({ page: z.string() })
