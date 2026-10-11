import { waitFor } from '../src/wait'

test('own', async () => {
  await waitFor(() => true)
})
