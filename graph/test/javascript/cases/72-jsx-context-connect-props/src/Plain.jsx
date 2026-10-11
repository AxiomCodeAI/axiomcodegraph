import { connect } from './db';

// CONTROL: not wrapped by connect(...)(C) — its props come from nobody the graph sees
export function Plain(props) {
  return <button onClick={props.onClickLogout}>out</button>;
}

// CONTROL: a one-shot connect(...) that is not curried is not a component wrapper
export const conn = connect({ onClickLogout: () => 'db' });
