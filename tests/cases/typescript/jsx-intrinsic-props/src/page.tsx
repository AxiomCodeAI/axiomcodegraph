export function Page(): unknown {
  return (
    <form class="f">
      <h1>title</h1>
    </form>
  )
}

// CONTROL: renders only an img, whose props are ImageProps
export function Picture(): unknown {
  return <img src="a.png" />
}

// CONTROL: a comparison, a string and a comment that spell a tag render nothing
export function Compare(a: number, img: number): string {
  // <form> in a comment
  return a<img ? '<h1 class="x">' : ''
}
