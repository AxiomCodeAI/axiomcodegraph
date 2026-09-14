export async function loadAndCall() {
  const m = await import('./base.js');
  m.util();
  const { util } = await import('./base.js');
  util();
  import('./base.js').then((mod) => mod.util());
  return 0;
}
