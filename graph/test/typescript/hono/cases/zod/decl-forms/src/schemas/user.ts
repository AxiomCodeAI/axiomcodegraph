import { z } from 'zod'

export const User = z.object({ name: z.string() })

const Settings = z.object({ theme: z.string() })
export default Settings
