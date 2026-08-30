// JSX_COMPONENT_CALL. `<Panel />` is an INVOCATION of Panel, and a golden that does
// not record it cannot tell "resolved" apart from "never seen".
//
// The JSX namespace is declared here so the case typechecks with no React dependency:
// the point under test is component invocation, not a framework's typings.
declare global {
  namespace JSX {
    type Element = string;
    interface ElementAttributesProperty {
      props: unknown;
    }
    interface IntrinsicElements {
      [name: string]: unknown;
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}

export type Props = { title: string; children?: unknown };

export function Panel(props: Props): string {
  return props.title;
}

export function Badge(): string {
  return "badge";
}

export class Widget {
  render(): string {
    return "w";
  }
}

export function App(): string {
  const a = <Panel title="x" />;
  const b = (
    <Panel title="y">
      <Badge />
    </Panel>
  );
  const w = new Widget();
  return a + b + w.render();
}

// ── client -> library ────────────────────────────────────────────────────────
import { Card, Theme } from "../lib/ui";

export function LibApp(): string {
  // A LIBRARY component invoked as JSX from client code.
  const c = <Card label="z" />;
  return c + new Theme().color();
}
