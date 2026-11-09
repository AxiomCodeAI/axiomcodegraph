/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx'

export const Layout: FC = (props) => (
  <html>
    <body>{props.children}</body>
  </html>
)

export const Greeting: FC<{ name: string }> = ({ name }) => <h1>Hello {name}</h1>
