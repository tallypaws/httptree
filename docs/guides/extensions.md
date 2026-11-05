---
title: Extensions
---

# Extensions

extensions can add methods and properties to every request in a tree and can register middleware and routes

```ts
import { root, text } from "@tally.paws/httptree";
import { cookies } from "@tally.paws/httptree-ext-cookies";
import { cors } from "@tally.paws/httptree-ext-cors";
import { compress } from "@tally.paws/httptree-ext-compress";

const tree = root()
  .extend(cookies)
  .extend(cors({ origin: "https://app.example.com", credentials: true }))
  .extend(compress())
  .derive(async (req) => ({ theme: req.getCookie("theme") ?? "light" }));

tree.get("/", (req) => text(req.data.theme)); // req.getCookie exists, req.data.theme is a string
```

## Using extensions

- **`extend()` comes first.** it throws if the tree already has routes, middleware or branches, so every branch sees the extension

```ts
import { root, json } from "@tally.paws/httptree";
import { cookies } from "@tally.paws/httptree-ext-cookies";

const tree = root();

tree.get("/", (req) => json(req.getCookies()));

tree.extend(cookies); // this will throw
```

- **keep what it returns.** `extend` returns the same tree typed with the new members

```ts
import { root, json } from "@tally.paws/httptree";
import { cookies } from "@tally.paws/httptree-ext-cookies";

const tree = root();

tree.extend(cookies); // this will not throw

tree.get("/", (req) => json(req.getCookies())); // but this method will be untyped
```

## Official extensions

| package                     | what it does                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| {@link cookies `cookies`}   | `req.getCookies()`, `req.getCookie(name)`, `req.setCookie()`, plus `cookie()`, `clearCookie()` and `withCookies()`                          |
| {@link cors `cors`}         | `cors(options)` answers preflight and adds headers to every response                                                                        |
| {@link compress `compress`} | `compress(options)` brotli, gzip and deflate for handlers, errors and streams                                                               |
| {@link static `static`}     | `serveStatic(dir)` handler, and `staticFiles()`                                                                                             |
| {@link validate `validate`} | `req.getQuery(schema)` and `req.getParams(schema)`, any Standard Schema library works, zod is used as an example (and my personal favorite) |
| {@link ip `ip`}             | `req.getIp()` to get client ips behind reverse proxies or tunnels                                                                           |

> [!NOTE]
> json body validation (`req.getJSON({ schema })`) is built in and does not need an extension

a few things are plain helpers instead of extensions because they only touch responses (`cookie()`, `withCookies()`, `serveStatic()`), you can use them without extending anything

## Writing an extension

```ts
import {
  defineExtension,
  perRequest,
  text,
  type HttpTreeRequest
} from "@tally.paws/httptree";

const started = perRequest(() => Date.now());

export const timing = defineExtension({
  name: "timing",
  request: {
    elapsed(): number {
      return Date.now() - started(this);
    }
  },
  setup(root) {
    // runs once when the extension is added
    root.use((req) => void started(req), 100); // start the clock before anything else
    root.use((req) => {
      if (req.response) req.response.headers["X-Took"] = `${req.elapsed()}ms`;
    }, -1000);
  }
});

const tree = root().extend(timing);
tree.get("/", (req) => text(`${req.elapsed()}ms so far`));
```

- **`name`** must be unique, adding the same name twice throws
- **`request`** an object of methods and getters, they are copied onto the request class when the extension is added
- **`setup(root)`** optional, runs once. Register middleware here, or routes (see `staticFiles`)
- **`requires`** names of extensions that have to be added first, checked on add

### rules

1. **type return types of methods that use `this`.** typescript can not infer a type that depends on `this` inside the object it is typing, you get an implicit `any` error.
2. **`this` is a plain request**, not your own members. to call another extension's members, type `this` and add it to `requires`:

   ```ts
   import type { CookieRequest } from "@tally.paws/httptree-ext-cookies";

   defineExtension({
     name: "session",
     requires: ["cookies"],
     request: {
       sessionId(this: HttpTreeRequest & CookieRequest): string | undefined {
         return this.getCookie("sid");
       }
     }
   });
   ```

3. **no per request fields on the request.** keep state in `perRequest(init)` or `perRequestLazy(init)` which also has `peek(req)` to read without creating, use it in "after" middleware so requests that never touched your extension cost nothing
4. **names can not collide.** adding a member that already exists on the request (node's own, httptree's or another extension's) throws when the extension is added
5. **use the header helpers** (`getHeader`, `setHeader`, `appendHeader`, `addVary`, `deleteHeader`) on `response.headers`, the object is case sensitive but http is not, and `Set-Cookie` needs to stay an array
6. **pick priorities on purpose.** middleware runs high to low, handlers are `0`, `use` defaults to `1`. things that need to see the final response go below zero (compress `-1000`, cookies `-1000`), things that need to answer first go high (cors `1000`)

### middleware info

- a response returned from middleware does not stop later middleware, only later handlers. a response _thrown_ by a later middleware replaces it. an auth middleware that rejects every request without credentials will replace a CORS preflight answer, make it skip with `if (req.sentResponse()) return;` or register it on a branch
- middleware also runs for errors and `404`, check `req.response` before assuming a handler ran
- anything a handler writes straight to the raw `res` never becomes `req.response`, "after" middleware like compress can not see it

### typed `req.data` with `derive`

`derive` is for per request values, not for methods. it runs like middleware and merges what it returns into `req.data`, typed for everything registered after it

```ts
const api = tree
  .branch("/api")
  .derive(async (req) => ({ user: await findUser(req.getCookie("sid")) }));
api.get("/me", (req) => json(req.data.user)); // only typed under /api
```

use `extend` when you add a **method** to the request, `derive` when you add a **value** to `req.data`

### publishing

an extension package depends on httptree as a **peer dependency** so there is one copy of it

```json
{
  "name": "httptree-ext-yours",
  "type": "module",
  "peerDependencies": { "@tally.paws/httptree": "^0.6.0" }
}
```

export the extension (or a function that returns one, like `cors(options)`) and the interface of what it adds, so people can annotate handlers that live in their own files:

```ts
import type { HttpTreeRequest } from "@tally.paws/httptree";
import type { CookieRequest } from "@tally.paws/httptree-ext-cookies";

export function handler(req: HttpTreeRequest<{}, CookieRequest>) {
  return req.getCookie("sid");
}
```
