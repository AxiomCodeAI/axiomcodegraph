import { UserRepo, KeyRepo } from './repos'

export class UserService {
  private repo: UserRepo
  constructor(repo: UserRepo) {
    this.repo = repo
  }
  find(id: string) {
    return this.repo.byId(id)
  }
}

export class KeyService {
  private repo: KeyRepo
  constructor(repo: KeyRepo) {
    this.repo = repo
  }
  verify(key: string) {
    return this.repo.lookup(key).length > 0
  }
}

export class AuditService {
  record(what: string) {
    return what.length
  }
}
