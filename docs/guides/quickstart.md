---
title: Quickstart
---

# Quickstart

## Install

```bash
npm install @tally.paws/httptree
```

httptree needs node 18 or newer

the package is ESM, so use `import` and set `"type": "module"` in your `package.json`

CJS support may come later for the weird people

## Basic server

the core of this package is the {@link core!root | root} function

```ts
// server.ts
import { root, json, text } from "@tally.paws/httptree";

// create a tree (router)
const tree = root();

// register a handler
tree.get("/", () => text("hello"));

// [id] is a parameter, instead of a fixed path its value can be any string
// eg: /users/12, /users/hi, /users/923758923752983579028672098
tree.get("/users/[id]", (req) => json({ id: req.params.id }));

tree.post("/echo", async (req) => {
  // get the request body, parsed as JSON
  // do not blindly trust the shape of this object
  // "{ message: string }" here only provides a type, it does not guarantee the data is valid
  const body = await req.getJSON<{ message: string }>();
  return json({ msg: body.message });
});

await tree.listen(3000);
console.log("listening on http://localhost:3000");
```

start the server, then test:

```bash
curl http://localhost:3000/
curl http://localhost:3000/users/42
curl -X POST http://localhost:3000/echo \
  -H "Content-Type: application/json" \
  -d '{"message":"hi"}'
```

## Returning things

you don't have to use a helper, these are all valid handler returns:

```ts
tree.get("/a", () => "plain text"); // text/plain
tree.get("/b", () => ({ hello: "world" })); // application/json
tree.get("/c", () => 42); // application/json
tree.get("/d", () => json({ ok: true }, { status: 201 }));
```

returning nothing (`undefined`) sends no body and the request moves on to the next middleware, if nothing ever sends a body the response is an empty `204`

## Stopping the server

```ts
await tree.stop();
```

there are two optional dependencies for extra features

```bash
npm install ws       # websocket routes
npm install busboy   # multipart/form-data (file uploads)
```

[Next](./basics.md)
