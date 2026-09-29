import axios from 'axios';

export function renderItems(res) { return res.data; }
export function onSaved(res) { return res.status; }
export function readToken(value) { return value; }

export function loadItems() {
  return axios.get('/api/items').then(renderItems);
}
export function saveItem(item) {
  return axios.post('/api/items', item).then((r) => onSaved(r));
}
export function guard(request, Response) {
  if (!readToken(request.cookies.get('t'))) return Response.redirect('/login');
  return null;
}
