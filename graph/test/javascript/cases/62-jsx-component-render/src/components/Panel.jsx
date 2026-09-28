// A class component with no constructor, as most are: rendered, and `this.props`
// holds the attributes.
export default class Panel {
  render() {
    return <section onClick={() => this.props.onClose()} />;
  }
}
