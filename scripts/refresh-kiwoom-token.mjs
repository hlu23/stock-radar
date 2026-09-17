import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const radarEnvPath = path.join(root, ".env");
const traderEnvPath = path.join("C:", "Users", "choid", "kiwoom-trader", ".env");

function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const at = text.indexOf("=");
    if (at < 1) continue;
    let value = text.slice(at + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[text.slice(0, at).trim()] = value;
  }
  return out;
}

function upsertEnv(file, patch) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) return line;
    const key = text.slice(0, text.indexOf("=")).trim();
    if (patch[key] == null) return line;
    seen.add(key);
    return `${key}=${patch[key]}`;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  fs.writeFileSync(file, next.filter((line, i, arr) => !(i === arr.length - 1 && line === "")).join("\n") + "\n");
}

const trader = loadEnvFile(traderEnvPath);
const radar = loadEnvFile(radarEnvPath);
const appKey = radar.KIWOOM_APP_KEY || trader.KIWOOM_APP_KEY || "";
const secret = radar.KIWOOM_SECRET_KEY || trader.KIWOOM_SECRET_KEY || "";
const host = (radar.KIWOOM_HOST || trader.KIWOOM_HOST || "real").toLowerCase();
const base = host === "demo" ? "https://mockapi.kiwoom.com" : "https://api.kiwoom.com";

if (!appKey || !secret) {
  console.error("missing-keys");
  process.exit(1);
}

if (trader.KIWOOM_APP_KEY && trader.KIWOOM_SECRET_KEY) {
  upsertEnv(radarEnvPath, {
    KIWOOM_HOST: host,
    KIWOOM_APP_KEY: trader.KIWOOM_APP_KEY,
    KIWOOM_SECRET_KEY: trader.KIWOOM_SECRET_KEY,
  });
}

const res = await fetch(`${base}/oauth2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json;charset=UTF-8" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    appkey: appKey,
    secretkey: secret,
  }),
});
const data = await res.json().catch(() => ({}));
const ok = res.ok && (data.return_code == null || data.return_code === 0) && Boolean(data.token);
console.log(JSON.stringify({
  ok,
  host,
  status: res.status,
  returnCode: data.return_code ?? null,
  returnMsg: data.return_msg || null,
  tokenLen: data.token ? String(data.token).length : 0,
  expires: data.expires_dt || null,
  syncedFromTrader: Boolean(trader.KIWOOM_APP_KEY && trader.KIWOOM_SECRET_KEY),
}));
if (!ok) process.exit(2);
