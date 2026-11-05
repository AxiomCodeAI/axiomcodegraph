import { Watchdog, Ticker, Silent, Ignores } from "./timers";

function reportTimeout(): void {}
function countTick(): void {}
function finishQuietly(): void {}
function finishIgnored(): void {}

export function start(): string {
  const dog = new Watchdog(reportTimeout, "dog");
  const ticker = new Ticker(countTick, 10);
  ticker.start();
  const quiet = new Silent(finishQuietly);
  new Ignores(finishIgnored);
  return dog.expire() + quiet.name();
}
