// A static server for pages/ and dist/ on a free port.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (!/^\/(pages|dist|profiles)\/[\w.-]+$/.test(p)) return res.writeHead(404).end();
    try {
      const body = await readFile(path.join(here, p));
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream", "cache-control": "no-store", "access-control-allow-origin": "*" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise(r => server.listen(port, () => r({ url: `http://localhost:${server.address().port}`, close: () => server.close() })));
}
