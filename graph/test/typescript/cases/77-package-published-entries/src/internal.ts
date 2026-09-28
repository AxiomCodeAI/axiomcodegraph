// CONTROL: imported by index.ts but named by no package.json entry, so its exports
// are not the package's API. notPublished must stay unreachable.
export function describeState(value: number) {
  return `state=${value}`;
}

export function notPublished() {
  return 'never called';
}
