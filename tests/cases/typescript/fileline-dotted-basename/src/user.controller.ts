import { UserService } from './user.service';

export class UserController {
  constructor(private readonly users: UserService) {}

  get(id: string): string {
    return this.users.find(id);
  }
}
