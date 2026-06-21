// Fetch chat-capable models from the OpenAI /v1/models endpoint.

// DeepSeek speaks the OpenAI Chat Completions wire format at a different base
// URL and exposes a small, fixed catalog (no live discovery needed here).
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];
export function isDeepSeekModel(id) {
  return /^deepseek/i.test(String(id || ""));
}

const SKIP = [
  "embedding", "tts", "whisper", "dall-e", "davinci", "babbage", "moderation",
  "transcribe", "realtime", "audio", "image", "sora", "computer-use",
];

function isChatModel(id) {
  const lower = id.toLowerCase();
  if (SKIP.some(s => lower.includes(s))) return false;
  return /^(gpt-|o[134]|chatgpt)/.test(lower);
}

export async function listOpenAiModels(apiKey) {
  if (!apiKey) return [];
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI models ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data || [])
    .filter(m => isChatModel(m.id))
    .map(m => ({ id: m.id, created: m.created, ownedBy: m.owned_by }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
