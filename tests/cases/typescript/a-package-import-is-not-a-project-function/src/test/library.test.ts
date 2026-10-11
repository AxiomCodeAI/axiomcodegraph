import { screen, waitFor } from '@testing-library/dom'
import { POLL_MS } from '../src/wait'

test('the library helper, in a file that loads the project function too', async () => {
  await waitFor(() => screen.getByText('x'), { interval: POLL_MS })
})
