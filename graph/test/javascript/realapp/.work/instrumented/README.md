# A real application, with its real dependencies

`run.sh` installs this express service's pinned `node_modules`, parses every package in
place and stages all of them as `--library`, solves, and then scores the graph two ways:
the compiler per site (with `node_modules` present, so tsc follows into the packages),
and execution per edge — `exercise.js` drives every route, the param handler, both error
paths, the events and the async handler under the runtime tracer with `node_modules`
instrumented too, so the edges from express INTO the app's handlers are recorded.

What this exercises that the torture project cannot: `express()` returning a function
that gets its members by `merge-descriptors`; `Router()` getting its prototype by
`setprototypeof`; `proto[method] = ...` over the `methods` package's array of strings;
`require('debug')('ns')` through a conditional re-export and `require('./common')(exports)`;
handlers receiving `req`/`res`/`next` that express manufactures — a stated model
(`graph/javascript/engine/resolution/frameworks.dl`), checked here against what ran.

`known-missing.txt` lists the executed edges the engine cannot have, each with its reason.
