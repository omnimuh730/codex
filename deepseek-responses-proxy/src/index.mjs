#!/usr/bin/env node
// Entry point: start the Responses→DeepSeek translation proxy.
import { createConfig, createServer } from "./server.mjs";

const cfg = createConfig();
if (!cfg.deepseekApiKey) {
  console.warn("[deepseek-responses-proxy] WARNING: DEEPSEEK_API_KEY is not set; /v1/responses will 500.");
}
createServer(cfg).listen(cfg.port, () => {
  console.log(`\n  deepseek-responses-proxy  →  http://127.0.0.1:${cfg.port}/v1/responses`);
  console.log(`  upstream                  →  ${cfg.deepseekUrl}`);
  console.log(`  auth enforced             →  ${cfg.authToken ? "yes" : "no (dev)"}\n`);
});
