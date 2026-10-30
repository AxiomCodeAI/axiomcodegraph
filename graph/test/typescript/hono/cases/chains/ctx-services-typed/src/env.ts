import type { UserService, KeyService, AuditService } from './services'

// the Env as a type alias
export type Env = { Variables: { services: { users: UserService; keys: KeyService }; audit: AuditService } }

// the same shape as an interface
export interface IEnv {
  Variables: { users: UserService }
}
