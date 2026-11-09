// census: ctx_di on a rebased root (SPEC R18 on a PARTIAL route: http_route_partial, dynamic_mount_prefix)
// The served app takes its base path from the environment, so every route under it is partial (its full path is
// not decidable). What R18 asks does not depend on the path: the handler still reads the service out of the
// context, typed by the sub-app's Env, and its calls must still resolve. At run time the variable is unset, so the
// chains are requested at the un-rebased path.
export class Db {
  get(key: string): string[] {
    return [key]
  }
  del(key: string): boolean {
    return key.length > 0
  }
}

export class UserRepo {
  private db: Db
  constructor(db: Db) {
    this.db = db
  }
  byId(id: string) {
    return this.db.get(`user:${id}`)
  }
  drop(id: string) {
    return this.db.del(`user:${id}`)
  }
}

export class UserService {
  private repo: UserRepo
  constructor(repo: UserRepo) {
    this.repo = repo
  }
  find(id: string) {
    return this.repo.byId(id)
  }
  remove(id: string) {
    return this.repo.drop(id)
  }
}
