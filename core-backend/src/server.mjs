// Standalone profile/resume/model API backed by MongoDB.
import http from "node:http";
import { CONFIG } from "./config.mjs";
import { listProfiles, getProfileById, getProfileResumes } from "./resumes.mjs";
import { listOpenAiModels, DEEPSEEK_MODELS } from "./models.mjs";

function sendJSON(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
}

async function resolveApiKey(profileId) {
  if (!profileId) return CONFIG.openaiApiKey;
  const profile = await getProfileById(profileId);
  return profile?.openaiApiKey || CONFIG.openaiApiKey;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  if (pathname === "/api/health") {
    return sendJSON(res, 200, {
      ok: true,
      service: "core-backend",
      mongoUri: CONFIG.mongoUri,
      mongoDb: CONFIG.mongoDb,
    });
  }

  if (pathname === "/api/profiles" && req.method === "GET") {
    try {
      const profiles = await listProfiles();
      return sendJSON(res, 200, { profiles });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && req.method === "GET") {
    try {
      const profile = await getProfileById(profileMatch[1]);
      if (!profile) return sendJSON(res, 404, { error: "profile not found" });
      const { openaiApiKey, ...safe } = profile;
      return sendJSON(res, 200, { profile: safe });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  const profileResumesMatch = pathname.match(/^\/api\/profiles\/([^/]+)\/resumes$/);
  if (profileResumesMatch && req.method === "GET") {
    try {
      const info = await getProfileResumes(profileResumesMatch[1]);
      if (!info) return sendJSON(res, 404, { error: "profile not found" });
      return sendJSON(res, 200, info);
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  if (pathname === "/api/models" && req.method === "GET") {
    try {
      const profileId = url.searchParams.get("profileId");
      // OpenAI models need a key to discover; DeepSeek's fixed catalog is always offered.
      const apiKey = await resolveApiKey(profileId);
      let models = [];
      if (apiKey) {
        try { models = await listOpenAiModels(apiKey); } catch (err) { console.warn(`OpenAI model list failed: ${err?.message || err}`); }
      }
      models = [...models, ...DEEPSEEK_MODELS.map((id) => ({ id }))];
      return sendJSON(res, 200, { models });
    } catch (err) {
      return sendJSON(res, 500, { error: String(err?.message || err) });
    }
  }

  sendJSON(res, 404, { error: "not found" });
});

const port = Number(process.env.CORE_BACKEND_PORT || process.env.PORT || 8790);
server.listen(port, () => {
  console.log(`\n  core-backend API  →  http://localhost:${port}`);
  console.log(`  MongoDB           →  ${CONFIG.mongoUri}/${CONFIG.mongoDb}\n`);
});
