---
title: Advanced
---

# Advanced

advanced usage and configuration

## Middleware

register middleware with `use`, it runs for every request on the tree or only for requests under a branch's prefix when registered on one

```ts
tree.use((req) => {
  req.data.start = Date.now();
});
```

`req.data` is an empty object created for each request, for passing values between middleware and handlers.

### Priority and order

middleware and route handlers share one ordered chain

- higher priority runs first, equal priorities run in registration order
- route handlers have priority `0` and `use` defaults to `1`, so middleware runs **before** handlers unless you say otherwise.
- negative priorities run **after** the handler

```ts
tree.use(() => console.log("first"), 10);

tree.use((req) => {
  req.data.start = Date.now();
});

// after the handler
tree.use((req) => {
  if (req.isError()) return;
  req.response!.headers["X-Took"] = `${Date.now() - req.data.start}ms`;
}, -1);

// last resort
tree.use((req) => {
  if (!req.sentResponse()) return text("nobody answered this one");
}, -10);
```

once a response exists (or an error was thrown) later handlers are skipped but middleware still runs, that is what makes "after" middleware possible, it can read or replace `req.response`

routes take a priority too as their last argument: `tree.get("/x", handler, 5)`.

### Short-circuiting

return a response (or throw one) from middleware to answer early:

```ts
const admin = tree.branch("/admin");

admin.use((req) => {
  if (!req.headers.authorization) throw error.unauthorized();
});
```

### Wrapping the rest of the chain

middleware can take a third argument, `getNext`, to run code around everything after it:

```ts
tree.use(async (req, res, getNext) => {
  const next = getNext(); // take over control of the chain
  console.log("before");
  await next(); // run the rest of the chain
  console.log("after");
});
```

- call `getNext()` to switch to manual mode, then call the function it returns to continue
- pass an error to fail the request: `await next(new Error("boom"))`

> [!WARNING]
> if you take control with `getNext()` and then never call the result the request will hang until the connection closes or times out

## Request state

besides `params` and `data` the request exposes the state of the chain:

| Member               | Meaning                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `req.response`       | the {@link core!TreeResponse TreeResponse} produced so far, if any |
| `req.sentResponse()` | `true` if a response exists or was written to `res`                |
| `req.isError()`      | `true` if something threw or the status is 400 or above            |
| `req.error`          | the thrown value, if any                                           |

see {@link core!TreeRequestExtras | TreeRequestExtras} for the full list

## Error handlers

use `handleError` to control what clients see, handlers are keyed by type: `"NotFound"`, `"MethodNotAllowed"`, `"InternalError"`, or `"*"` for any of them.

```ts
tree.handleError("NotFound", (err, req) =>
  json({ error: "not found", path: req.url }, { status: 404 })
);

tree.handleError("InternalError", (err) => {
  console.error(err);
  return error.internalServerError({ error: "something broke" });
});
```

a handler registered on a branch applies to that branch first, if it has none for the type httptree walks up through the parent branches, an error handler that throws is logged and the default response is used instead

errors thrown with the `error.*` helpers are normal responses and skip error handlers

## WebSockets

install `ws`, then register websocket routes with `ws`, they use the same path syntax and branch prechecks as HTTP routes

```ts
tree.ws("/chat/[room]", (ws, req) => {
  ws.send(`welcome to ${req.params.room}`);
  ws.on("message", (msg) => ws.send(`echo: ${msg}`));
});

await tree.listen(3000);
```

a failed precheck closes the socket with code `1008`, a path with no websocket route closes it with `1002`

for other upgrade protocols register a custom handler with `useUpgrade`, return `true` if you took the socket:

```ts
tree.useUpgrade((req, socket, head) => {
  if (req.url !== "/custom") return false;
  // ...handle the socket yourself
  return true;
}, 10);
```

## Running more than one tree

each {@link core!root | root} is independent so you can serve several trees on different ports:

```ts
const publicTree = root();
const adminTree = root();

await publicTree.listen(3000);
await adminTree.listen(3001);
```

## Using your own server

`tree.handle(req, res)` is a plain `(IncomingMessage, ServerResponse)` function so you can mount a tree inside an existing server:

```ts
import { createServer } from "node:http";

createServer((req, res) => void tree.handle(req, res)).listen(3000);
```

prefer `tree.listen` when you can, it also sets up websocket upgrades for you

## Raw `http` access

handlers get node's `ServerResponse` as their second argument, if you write to it yourself and the response has already been sent httptree leaves it alone:

```ts
tree.get("/express", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ hello: "world" }));
});
```

## Debugging

set `HTTPTREE_DEBUG=1` to log route registration, matching and the middleware chain.

```bash
HTTPTREE_DEBUG=1 node server.js
```
