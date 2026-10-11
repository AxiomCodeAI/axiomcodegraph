/**
 * The namespace an element is in, which the HTML algorithm decides from context: an
 * `<svg>` opens the SVG namespace, `<math>` MathML, and `<foreignObject>` returns to HTML.
 * A `<script>` or `<style>` in SVG is not the HTML element of that name, so the front end
 * reads scripts and styles only in the HTML namespace.
 */
export enum HtmlNamespace {
  HTML = 'HTML',
  SVG = 'SVG',
  MATHML = 'MATHML',
}
