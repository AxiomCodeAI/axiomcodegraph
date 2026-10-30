import { Db } from './db'

export class UserRepo {
  private db: Db
  constructor(db: Db) {
    this.db = db
  }
  byId(id: string) {
    return this.db.query(`user ${id}`)
  }
}

export class KeyRepo {
  private db: Db
  constructor(db: Db) {
    this.db = db
  }
  lookup(key: string) {
    return this.db.query(`key ${key}`)
  }
}
