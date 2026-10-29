// census: verb_multi_handler (oracle gap O10 residual; SPEC R5)
// upgradeWebSocket taken from a PROJECT module that destructures createBunWebSocket() (imported relatively and
// through a tsconfig path alias): a library-call handler keyed at the call, after its per-route middleware.
import { Hono } from 'hono'
import { upgradeWebSocket } from './utils/websocket'
import { chat } from './chat'

const app = new Hono()
app.get('/live', upgradeWebSocket(() => ({ onOpen() {} })))
app.route('/chat', chat)

export default app
