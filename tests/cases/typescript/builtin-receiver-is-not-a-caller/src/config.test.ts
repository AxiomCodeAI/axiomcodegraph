import { readConfig, later } from "./app"
declare function it(name: string, fn: () => void): void
it("reads the config", () => { readConfig("{}") })
it("waits", () => { later(1) })
