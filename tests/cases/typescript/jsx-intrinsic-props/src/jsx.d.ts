// the project supplies its own JSX namespace: each tag is checked against the props type it maps to
export interface HtmlGlobalProps { class?: string }
export interface FormElementProps extends HtmlGlobalProps { action?: string }
export interface ImageProps extends HtmlGlobalProps { src: string }

declare global {
  namespace JSX {
    interface IntrinsicElements {
      form: FormElementProps
      h1: FormElementProps
      img: ImageProps
    }
  }
}
