import { error, json, root, text } from "httptree";

const tree = root();

tree.get("hi", () => {
  return text("hello");
});

tree.get("/post/[id]/[[version]]", (req) => {
  return json({ params: { id: req.params.id } });
});

function authorize(...e: any) {
  return true;
}

const api = tree.branch("/api");

const adminApi = api.branch("/admin", (req) => {
  return authorize(req.headers.authorization);
});

adminApi.delete("/user/[id]", ({ params }) => {
  //db stuff
});

tree.post("/posthaha", (req) => {
  const parsed = req.getJSON({})
});


