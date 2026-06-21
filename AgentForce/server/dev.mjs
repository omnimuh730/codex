// Runs the Vite dev server and the agent backend together.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules", ".bin", "vite");
const backendPort = process.env.PORT || "8787";
const vitePort = process.env.VITE_PORT || "5999";

function run(name, cmd, args, color, extraEnv = {}) {
  const p = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
  });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream) => stream.on("data", d => d.toString().split("\n").filter(Boolean).forEach(l => console.log(`${tag} ${l}`)));
  pipe(p.stdout); pipe(p.stderr);
  p.on("exit", code => {
    console.log(`${tag} exited (${code})`);
    if (code !== 0 && code !== null) process.exitCode = code;
  });
  return p;
}

console.log(`\n  AgentForce dev`);
console.log(`  UI (Vite)     →  http://localhost:${vitePort}`);
console.log(`  API (backend) →  http://localhost:${backendPort}\n`);

const server = run("server", process.execPath, [path.join(root, "server", "index.mjs")], "36", {
  PORT: backendPort,
});
const vite = run("vite", viteBin, [], "35", {
  VITE_PORT: vitePort,
  VITE_API_URL: `http://localhost:${backendPort}`,
});

const bye = () => { server.kill(); vite.kill(); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
