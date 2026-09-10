import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

await cp(
  path.join(root, "src", "i18n", "templates"),
  path.join(root, "dist", "i18n", "templates"),
  { recursive: true },
);
await cp(
  path.join(root, "src", "server", "public"),
  path.join(root, "dist", "server", "public"),
  { recursive: true },
);
