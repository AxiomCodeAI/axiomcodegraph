import usersRouter from './routes/users';
import { app, api } from './app';
api.use('/v1', usersRouter);
app.use('/api', api);
