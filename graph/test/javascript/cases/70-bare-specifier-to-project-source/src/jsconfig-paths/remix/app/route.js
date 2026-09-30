// paths without baseUrl, from a tsconfig.json nearer than the root jsconfig.json
import { getNote } from '~/models/note.server';

export async function loader({ params }) {
  return getNote(params.noteId);
}
