import { Type } from '@sinclair/typebox';
export const TaskSchema = Type.Object({ id: Type.String(), name: Type.String() });
export const CreateTaskSchema = Type.Object({ name: Type.String() });
export const UpdateTaskSchema = Type.Partial(CreateTaskSchema);
