import { Component } from "./jsx"
import { hitTest, persist, startClock, stopClock, onSave, drawRow, measure } from "./work"

// a class component: the renderer calls render and the lifecycle methods on the instance <Board/> builds
export class Board extends Component<{ id: string }> {
  componentDidMount(): void { startClock() }
  componentWillUnmount(): void { stopClock() }
  // a field holding an arrow, handed to an element by reference
  handleMove = (e: { x: number }): void => { hitTest(e.x) }
  render(): unknown {
    return (
      <div>
        <canvas onPointerMove={this.handleMove} />
        <button onClick={() => persist(this.props.id)}>save</button>
      </div>
    )
  }
}

export function mountBoard(): unknown {
  return <Board id="b1" />
}

// a function component handing a module function and a render callback to elements
export function Toolbar(): unknown {
  return (
    <nav>
      <button onClick={onSave} />
      <List renderItem={(i: number) => drawRow(i)} />
    </nav>
  )
}

export function List(props: { renderItem: (i: number) => string }): unknown {
  return <ul>{props.renderItem.length}</ul>
}

// CONTROL: a class with a render method that is never written as a tag is not a component: building it runs no render
export class Report {
  render(): number { return measure(1) }
}
export function makeReport(): Report {
  return new Report()
}

// CONTROL: an element whose attributes are data hands nothing over
export function Badge(): unknown {
  return <span title={String(measure(2))} />
}
