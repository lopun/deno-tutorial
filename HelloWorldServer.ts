import {serve} from "https://deno.land/std@0.78.0/http/server.ts";

const server = serve({port: 8000});
console.log("http://localhost:8000/");

for await (const req of server) {
  const url = req.url
  req.respond({body: `Hi user. You visited ${url}`});
}
