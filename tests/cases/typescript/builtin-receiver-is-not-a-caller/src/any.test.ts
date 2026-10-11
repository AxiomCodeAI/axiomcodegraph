import { readAny, drainAny } from "./app"
declare function it(name: string, fn: () => void): void
it("reads through anything", () => { readAny({ parse: () => 1 }, "x") })
it("drains anything", () => { drainAny({ resolve: () => "y" }) })
