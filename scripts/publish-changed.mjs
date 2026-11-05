import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dryRun = process.env.DRY_RUN === "1";

const dirs = [
  "pkg",
  ...readdirSync("ext", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join("ext", d.name))
];

function isPublished(name, version) {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    encoding: "utf8",
  });
  if (r.status === 0) return r.stdout.trim() === version;
  if (r.stderr.includes("E404")) return false;
  throw new Error(`npm view failed for ${name}@${version}:\n${r.stderr}`);
}

let failed = false;

for (const dir of dirs) {
  const {
    name,
    version,
    private: isPrivate
  } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (isPrivate) continue;

  if (isPublished(name, version)) {
    console.log(`skip     ${name}@${version}`);
    continue;
  }

  console.log(`publish  ${name}@${version}`);
  const args = ["publish", "--access", "public"];
  if (dryRun) args.push("--dry-run");

  const r = spawnSync("npm", args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`FAILED   ${name}@${version}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
