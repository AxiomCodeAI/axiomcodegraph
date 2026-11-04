// census: zvalidator (negative partition: zod with no Hono route, SPEC 3.9)
// zod used for plain parsing in a project that has no Hono app: zero route_* rows of any kind.
import { z } from 'zod'

export const Signup = z.object({ email: z.string(), password: z.string() })

export function parseSignup(input: unknown) {
  return Signup.parse(input)
}

export const Profile = Signup.omit({ password: true }).extend({ bio: z.string() })
export function parseProfile(input: unknown) {
  return Profile.safeParse(input)
}
