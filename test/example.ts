import { error, html, json, redirect, root, text } from "httptree";

const tree = root()
//methods
tree.get("/path", () => text("OK"));
tree.post("/path", () => text("OK"));
tree.patch("/path", () => text("OK"));
tree.delete("/path", () => text("OK"));
tree.put("/path", () => "OK"); // u can also just return a string and it does the same thing

tree.all("/all", (req) => text(req.method!));

// params
tree.get("/param/required/[required]", (req) => text(req.params.required));
tree.get("/param/optional/[[optional]]", (req) =>
  text(req.params.optional ?? "undefined")
);
tree.get("/param/rest/[...rest]", (req) =>
  text(req.params.rest.toString() ?? "undefined")
);

// ws

// runs before the handshake, so a rejection is a real http response
tree.useWS((req) => {
  if (req.url?.includes("deny")) throw error.forbidden("not today");
  req.data.joined = Date.now();
});

tree.ws("/ws", (ws) => {
  ws.send("hello from server");

  ws.on("message", (msg) => {
    ws.send(`echo: ${msg}`);
  });
});

//branch

const branch = tree.branch("/branch", (req) => {
  console.log("precheck");
  return true; // false would prevent the request from being handled by any handler in this branch
});

branch.get("/", () => text("OK"));
branch.get("/path", () => text("OK"));

const nested = branch.branch("/mendy");
nested.get("/nested", () => "OK");

const protectedBranch = branch.branch("/", (req, res) => {
  return false; // sends 403 forbidden
});

protectedBranch.get("/never", () => "OK");

// inherited params
const a = tree.branch("/a/[a]");

a.get("/", (req) => {
  return text(req.params.a);
});

const b = a.branch("/b/[b]");

b.get("/", (req) => {
  return json({ a: req.params.a, b: req.params.b });
});

// err
tree.get("/throw", () => {
  throw error.forbidden("nuh uh");
});
tree.get("/crash", () => {
  throw new Error("kaboom");
});

//etc

tree.get("/headers", () =>
  text("with headers", { headers: { "X-Custom": "hello" } })
);

tree.get("/redirect", () => redirect("/path"));

tree.get("/html", () =>
  html(`
    <h1>hello</h1>
    <p>world</p>
  `)
);

tree.get("/json", () => json({ hello: "world", cool: true }));

//middleware

tree.use((req, res) => {
  if (req.url === "/middleware") return text("hello"); // you could also res.end() but thats evil
});

tree.use((req, res) => {
  console.log("high priority");
}, 10);

tree.use((req) => {
  req.data.start = Date.now();
});

// after the main route
tree.use((req) => {
  if (req.isError()) return;
  req.response!.headers["X-Took"] = `${Date.now() - req.data.start}ms`;
}, -1);

tree.use((req) => {
  if (!req.sentResponse()) return text("nobody answered this one");
}, -10);

const admin = tree.branch("/admin");
admin.use((req) => {
  if (!req.headers.authorization) throw error.unauthorized();
});
admin.get("/stats", () => json({ users: 3 }));

tree.get("/data", (req) => {
  return json({ started: req.data.start });
});

tree.get("/async", async () => {
  await new Promise((r) => setTimeout(r, 100));

  return text("done");
});

tree.post("/body/json", async (req) => {
  const body = await req.getJSON<{ name: string }>({ maxSize: "10kb" });
  return json({ hello: body.name });
});

tree.post("/body/text", async (req) =>
  text((await req.getText()).toUpperCase())
);

tree.post("/body/validated", async (req) => {
  const body = await req.getJSON({
    validate: (v: any) => {
      if (typeof v?.n !== "number") throw new Error("n must be a number");
      return v as { n: number };
    }
  });
  return json({ doubled: body.n * 2 });
});

tree.post("/body/upload", async (req) => {
  const avatar = await req.getFile("avatar", { maxFileSize: "2mb" });
  const { fields } = await req.getForm();
  return json({
    fields,
    avatar: avatar && { name: avatar.filename, size: avatar.size }
  });
});

// legacy

// you can do express style responses but why the fuck would you
tree.get("/express", (req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");

  res.end(JSON.stringify({ hello: "world" }));
});

// this does the same exact thing
tree.get("/httptree", () =>
  json({
    hello: "world",
  }),
);

tree.use(async (req, res, getNext) => {
  console.log("before");

  const next = getNext();
  await next();

  console.log("after");
});

tree.use(async (req, res, evilness) => {
  // this is evil
  await evilness()();
});

await tree.listen(3000);

// or tree.listen(3000, () => {})

// supports two trees
const aSECONDtree = root();
aSECONDtree.get("/hawwo", () => "HI");
aSECONDtree.use(() => {
  console.log("request!");
});
await aSECONDtree.listen(3001);
