// census: route_mount_literal (project sources under lib/ and libs/, a common monorepo layout)
// A project path that starts with lib/ or libs/ is project code, not a library key.
import { app } from './lib/app'
import { users } from './libs/users/routes'

app.route('/users', users)

export default app
