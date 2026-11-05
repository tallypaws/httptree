---
title: Basics
---

# Basics

the basics for everyday use

## Routes

register routes with the method that matches the HTTP method:

```ts
tree.get("/path", () => "OK");
tree.post("/path", () => "OK");
tree.put("/path", () => "OK");
tree.patch("/path", () => "OK");
tree.delete("/path", () => "OK");
tree.all("/path", (req) => req.method); // any method
```

if a path exists but not for the method used, the answers `405 Method Not Allowed` and fills in the `Allow` header, if nothing matches it answers `404`

when several routes could match the most specific one wins, fixed segments beat dynamic parameters so `/users/me` is chosen over `/users/[id]` no matter which was registered first

## Parameters

| Syntax      | Meaning                            | Type                  |
| ----------- | ---------------------------------- | --------------------- |
| `[name]`    | required segment                   | `string`              |
| `[[name]]`  | optional segment                   | `string \| undefined` |
| `[...name]` | the rest of the path, split on `/` | `string[]`            |

```ts
tree.get("/users/[id]", (req) => req.params.id);
tree.get("/files/[[name]]", (req) => req.params.name ?? "no name");
tree.get("/static/[...path]", (req) => req.params.path.join(" > "));
```

values are already URL decoded, a malformed encoding gets a `400`

## Responses

handlers can return a plain value or a {@link core!TreeResponse | TreeResponse} built by one of the helpers:

| Helper                         | Produces                                          |
| :----------------------------- | :------------------------------------------------ |
| {@link core!json json}         | `application/json`                                |
| {@link core!text text}         | `text/plain`                                      |
| {@link core!html html}         | `text/html`                                       |
| {@link core!redirect redirect} | a redirect with a `Location` header (default 302) |
| {@link core!file file}         | a download with `Content-Disposition: attachment` |
| {@link core!raw raw}           | a `Buffer` with whatever headers you give         |
| {@link core!stream stream}     | a readable stream                                 |
| {@link core!error error}       | an error status, see [Errors](#errors)            |

every helper that takes options accepts `status` and `headers`:

```ts
tree.post("/things", () =>
  json({ created: true }, { status: 201, headers: { "X-Thing": "1" } })
);

tree.get("/old", () => redirect("/new", 301));
```

## Branches

a branch is a subrouter at a specific path, routes registered on it inherit that path

```ts
const api = tree.branch("/api");

api.get("/users", () => json([])); // GET /api/users
api.get("/users/[id]", (req) => req.params.id);

const v1 = api.branch("/v1"); // branches nest
v1.get("/ping", () => "pong"); // GET /api/v1/ping
```

params are passed down too

```ts
const users = tree.branch("/users/[userId]");

users.get("/posts/[postId]", (req) =>
  json({ user: req.params.userId, post: req.params.postId })
);
```

### Branch guards

pass a callback as the second argument to guard everything in the branch (more than one is fine, see below), only returning `true` lets the request through and anything else stops it before the route handler runs

- `true` continues
- `false` (or nothing, or any other value) sends a `403`
- returning a response sends that response instead, so you can send a `401`, a redirect, `200`, or anything else
- throwing a response does the same thing as returning it

```ts
const admin = tree.branch("/admin", (req) => {
  return req.headers.authorization === "Bearer secret";
});

admin.get("/stats", () => json({ users: 3 }));

// custom responses
const account = tree.branch("/account", (req) => {
  if (!req.headers.cookie?.includes("session=")) return redirect("/login");
  return true;
});

const api = tree.branch("/api", async (req) => {
  if (!req.headers.authorization)
    return error.unauthorized({ error: "missing token" });
  if (await isRateLimited(req)) throw error.tooManyRequests();
  return true;
});
```

you can pass several guards. they run in order, parent branches first and then left to right, and the first one that does not return `true` answers the request:

```ts
const admin = tree.branch("/admin", isAuthed, isAdmin, auditLog);

// same thing, a nested branch adds its guards after the parent's
const same = tree.branch("/admin", isAuthed).branch("/", isAdmin, auditLog);
```

an earlier guard can put things in `req.data` for the later ones.

## Errors

throw an `error` helper to send an error response:

```ts
tree.get("/secret", () => {
  throw error.forbidden("nuh uh");
});

tree.get("/maybe", () => error.notFound({ reason: "gone" }));

tree.get("/custom", () => error(555, "this error doesnt exist"));
```

list of error helpers:
```ts
error.badGateway(body);
error.badRequest(body);
error.conflict(body);
error.forbidden(body);
error.internalServerError(body);
error.methodNotAllowed(body);
error.notFound(body);
error.payloadTooLarge(body);
error.serviceUnavailable(body);
error.tooManyRequests(body);
error.unauthorized(body);
error.unprocessableEntity(body);
error.unsupportedMediaType(body);
error(status, body);
```

anything else thrown is logged and becomes a `500`, to customize these responses see [error handlers](./advanced.md#error-handlers)

## Request bodies

read bodies with the helpers on `req`, all of them are async

```ts
tree.post("/json", async (req) => {
  const body = await req.getJSON<{ name: string }>();
  return json({ hello: body.name });
});

tree.post("/text", async (req) => (await req.getText()).toUpperCase());

tree.post("/bytes", async (req) => {
  const buf = await req.getBuffer({ maxSize: "5mb" });
  return json({ length: buf.length });
});
```

### Validating JSON

`validate` receives the parsed value, return the typed result or throw to send a `422` with an error message

```ts
tree.post("/double", async (req) => {
  const { n } = await req.getJSON({
    validate: (v: any) => {
      if (typeof v?.n !== "number") throw new Error("n must be a number");
      if (v.n !== 67) throw new Error("n must be 67");
      return v as { n: number };
    }
  });
  return json({ doubled: n * 2 });
});
```

### Forms and uploads

`getForm` handles `application/x-www-form-urlencoded` and `multipart/form-data`, multipart needs the `busboy` package

```ts
tree.post("/upload", async (req) => {
  const avatar = await req.getFile("avatar", { maxFileSize: "2mb" });
  const { fields } = await req.getForm();
  return json({
    fields,
    avatar: avatar && { name: avatar.filename, size: avatar.size }
  });
});
```

see {@link core!UploadedFile | UploadedFile} and {@link core!ParsedForm | ParsedForm}

### Size limits

set defaults for the whole tree with `root(...)` or `tree.config(...)`, options passed to the methods above override them

```ts
const tree = root({ body: { maxSize: "2mb", maxFileSize: "20mb" } });
```

| Option         | Default | Applies to               |
| -------------- | ------- | ------------------------ |
| `maxSize`      | `1mb`   | JSON, text, raw buffer   |
| `maxFileSize`  | `10mb`  | each uploaded file       |
| `maxFiles`     | `10`    | files per request        |
| `maxFields`    | `100`   | fields per form          |
| `maxFieldSize` | `100kb` | a single multipart field |

Sizes are a number of bytes or a string like `"512kb"`, `"1.5mb"` or `"2gb"`, see {@link core!BodyConfig | BodyConfig}

[Next](./advanced.md)
