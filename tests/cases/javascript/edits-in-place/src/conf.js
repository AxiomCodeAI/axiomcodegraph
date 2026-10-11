export const Settings = {
  retries: 3,
  timeoutMs: 1000,
};
export const LIMIT = { max: 1 };
export function total() {
  return Settings.retries + LIMIT.max;
}
