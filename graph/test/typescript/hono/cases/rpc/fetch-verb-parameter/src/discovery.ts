// the method is set on the init only inside a branch: GET or POST, decided at run time
export async function poll(push: boolean) {
  const init: RequestInit = { headers: { accept: 'application/json' } }
  if (push) {
    init.method = 'POST'
  }
  return fetch('http://localhost:8787/_discovery', init)
}
