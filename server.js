import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv();
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8787);
const KIWOOM_HOST = (process.env.KIWOOM_HOST || "real").toLowerCase();
const KIWOOM_APP_KEY = process.env.KIWOOM_APP_KEY || "";
const KIWOOM_SECRET_KEY = process.env.KIWOOM_SECRET_KEY || "";
const KIWOOM_BASE = process.env.KIWOOM_API_BASE
  || (KIWOOM_HOST === "demo" ? "https://mockapi.kiwoom.com" : "https://api.kiwoom.com");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const STOCK_NEWS = [
  "stock", "stocks", "shares", "share price", "nasdaq", "nyse", "otc",
  "earnings", "eps", "revenue", "guidance", "outlook", "dividend", "buyback",
  "ipo", "listing", "delist", "upgrade", "downgrade", "analyst", "price target",
  "valuation", "market cap", "sec", "8-k", "10-k", "10-q", "form 4", "filing",
  "fda", "clinical", "premarket", "after-hours", "after hours", "investor",
  "shareholder", "offering", "merger", "acquisition", "takeover", "halt",
  "rally", "plunge", "selloff", "beats", "misses", "rating", "overweight",
  "underweight", "outperform", "coverage", "options", "etf", "short interest",
  "float", "warrant", "convertible", "atm offering", "reverse split",
  "stock split", "buy zone", "fair value",
];
const OFF_TOPIC_NEWS = [
  "emmy", "oscar", "grammy", "golden globe", "box office", "tv show",
  "comedy", "movie", "film premiere", "trailer", "album", "concert",
  "nfl", "nba", "mlb", "soccer", "premier league", "recipe",
  "fashion week", "red carpet", "streaming series",
];

const POSITIVE = [
  "upgrade", "beats", "beat estimates", "record", "approval", "fda", "contract",
  "buyback", "dividend", "surge", "soars", "rally", "breakout", "raises guidance",
  "partnership", "acquisition", "wins", "strong demand",
];
const NEGATIVE = [
  "downgrade", "miss", "misses", "lawsuit", "probe", "investigation", "recall",
  "fraud", "delay", "halt", "warning", "cuts guidance", "plunge", "selloff",
  "sec", "ban", "layoff", "weak demand", "guidance cut",
];

const OVERSEAS_PUBLISHERS = [
  "reuters", "bloomberg", "cnbc", "wsj", "wall street journal", "financial times",
  "ft.com", "marketwatch", "barron", "benzinga", "yahoo finance", "yahoo",
  "seeking alpha", "investopedia", "associated press", "ap news", "bbc",
  "the guardian", "forbes", "fortune", "business insider", "the motley fool",
  "nikkei", "scmp", "techcrunch", "the verge", "washington post", "nytimes",
  "new york times", "cnn", "fox business", "investing.com", "zacks", "tipranks",
  "thestreet", "morningstar", "s&p", "dow jones",
  "stock titan", "stocktitan", "globenewswire", "pr newswire", "prnewswire",
  "business wire", "businesswire", "accesswire", "sec.gov",
];

const KR_BLOCK = [
  "naver", "chosun", "hankyung", "hankook", "mk.co", "edaily", "fnnews",
  "yonhap", "mt.co.kr", "maeil", "donga", "joongang", "khan", "hani.co",
  "etnews", "inews24", "theguru", "sedaily", "newsis", "ytn", "sbs", "kbs",
  "mbc", "asiae", "heraldcorp", "bizwatch", "wowtv", "etoday", "moneys",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function loadDotEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const at = text.indexOf("=");
    if (at < 1) continue;
    const key = text.slice(0, at).trim();
    let value = text.slice(at + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function hasHangul(text) {
  return /[가-힣]/.test(text);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
  });
  if (!res.ok) throw new Error(`요청 실패 ${res.status}`);
  return res.json();
}

let yahooAuth = { cookie: "", crumb: "", at: 0 };

async function yahooCrumb() {
  if (yahooAuth.crumb && Date.now() - yahooAuth.at < 25 * 60 * 1000) return yahooAuth;
  const r1 = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const cookies = typeof r1.headers.getSetCookie === "function"
    ? r1.headers.getSetCookie()
    : [r1.headers.get("set-cookie")].filter(Boolean);
  const cookie = cookies.map((c) => String(c).split(";")[0]).join("; ");
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.startsWith("{")) throw new Error("Yahoo 호가 세션 실패");
  yahooAuth = { cookie, crumb, at: Date.now() };
  return yahooAuth;
}

async function yahooJson(url) {
  const { cookie, crumb } = await yahooCrumb();
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}crumb=${encodeURIComponent(crumb)}`, {
    headers: { "User-Agent": UA, Accept: "application/json", Cookie: cookie },
  });
  if (res.status === 401 || res.status === 403) {
    yahooAuth = { cookie: "", crumb: "", at: 0 };
    throw new Error(`요청 실패 ${res.status}`);
  }
  if (!res.ok) throw new Error(`요청 실패 ${res.status}`);
  return res.json();
}

let kiwoomAuth = { token: "", exp: 0 };
let kiwoomAuthDownUntil = 0;
let kiwoomTokenInflight = null;
const kiwoomBarCache = new Map();
let kiwoomExCache = new Map();
let kiwoomChartDownUntil = 0;
let kiwoomDownMsg = "";

function signedNum(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kiwoomExpires(expiresDt) {
  const s = String(expiresDt || "").replace(/\D/g, "");
  if (s.length < 14) return Date.now() + 23 * 3600 * 1000;
  const t = Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+09:00`);
  return Number.isFinite(t) ? t : Date.now() + 23 * 3600 * 1000;
}

function etUnix(y, mo, d, hh, mi, ss) {
  const utc = Date.UTC(y, mo - 1, d, hh, mi, ss);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = (ms) => {
    const o = {};
    for (const p of fmt.formatToParts(new Date(ms))) {
      if (p.type !== "literal") o[p.type] = Number(p.value);
    }
    return o;
  };
  let t = utc;
  for (let i = 0; i < 3; i += 1) {
    const got = parts(t);
    t += utc - Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
  }
  return Math.floor(t / 1000);
}

function kiwoomBarTime(row) {
  const raw = String(row?.cntr_tm || "");
  const digits = raw.replace(/\D/g, "");
  const bus = String(row?.bus_dt || "").replace(/\D/g, "");
  let s = digits;
  if (s.length === 6 && bus.length >= 8) s = bus.slice(0, 8) + s;
  if (s.length < 12) return null;
  return etUnix(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)),
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
    s.length >= 14 ? Number(s.slice(12, 14)) : 0,
  );
}

function kiwoomExchanges(hint) {
  const text = String(hint || "").toUpperCase();
  let first = "ND";
  if (/AMEX|ASE|ARCA|NYSE AMERICAN|NYSE MKT/.test(text)) first = "NA";
  else if (/\bNYSE\b|\bNYQ\b/.test(text)) first = "NY";
  const rest = ["ND", "NY", "NA"].filter((x) => x !== first);
  return [first, ...rest];
}

async function kiwoomToken() {
  if (!KIWOOM_APP_KEY || !KIWOOM_SECRET_KEY) return "";
  if (Date.now() < kiwoomAuthDownUntil) return kiwoomAuth.token || "";
  if (kiwoomAuth.token && Date.now() < kiwoomAuth.exp - 60_000) return kiwoomAuth.token;
  if (kiwoomTokenInflight) return kiwoomTokenInflight;
  kiwoomTokenInflight = (async () => {
    const res = await fetch(`${KIWOOM_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: KIWOOM_APP_KEY,
        secretkey: KIWOOM_SECRET_KEY,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.return_code != null && data.return_code !== 0) || !data.token) {
      kiwoomAuthDownUntil = Date.now() + 30_000;
      kiwoomDownMsg = data.return_msg || `키움 토큰 실패 ${res.status}`;
      throw new Error(kiwoomDownMsg);
    }
    kiwoomAuth = { token: data.token, exp: kiwoomExpires(data.expires_dt) };
    return kiwoomAuth.token;
  })().finally(() => {
    kiwoomTokenInflight = null;
  });
  return kiwoomTokenInflight;
}

async function kiwoomRequest(path, apiId, body, { retried = false, contYn = "N", nextKey = "" } = {}) {
  if (Date.now() < kiwoomAuthDownUntil) {
    throw new Error(kiwoomDownMsg || "키움 인증 대기");
  }
  const token = await kiwoomToken();
  if (!token) return { data: null, contYn: "N", nextKey: "" };
  const res = await fetch(`${KIWOOM_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      authorization: `Bearer ${token}`,
      "api-id": apiId,
      "cont-yn": contYn || "N",
      "next-key": nextKey || "",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data.return_code === 8005 && !retried) {
    kiwoomAuth = { token: "", exp: 0 };
    return kiwoomRequest(path, apiId, body, { retried: true, contYn, nextKey });
  }
  if (data.return_code === 8005) {
    kiwoomAuthDownUntil = Date.now() + 45_000;
    kiwoomDownMsg = data.return_msg || "키움 토큰이 유효하지 않습니다";
    throw new Error(kiwoomDownMsg);
  }
  if (!res.ok || (data.return_code != null && data.return_code !== 0)) {
    throw new Error(data.return_msg || `키움 ${apiId} 실패 ${data.return_code ?? res.status}`);
  }
  return {
    data,
    contYn: res.headers.get("cont-yn") || "N",
    nextKey: res.headers.get("next-key") || "",
  };
}

async function kiwoomPost(path, apiId, body, retried = false) {
  const { data } = await kiwoomRequest(path, apiId, body, { retried });
  return data;
}

async function kiwoomListPages(path, apiId, body, maxPages = 3) {
  const rows = [];
  let contYn = "N";
  let nextKey = "";
  for (let page = 0; page < maxPages; page += 1) {
    const pack = await kiwoomRequest(path, apiId, body, { contYn, nextKey });
    const list = pack.data?.result_list || pack.data?.trde_qty_sdnin || [];
    if (Array.isArray(list)) rows.push(...list);
    if (pack.contYn !== "Y" || !pack.nextKey) break;
    contYn = "Y";
    nextKey = pack.nextKey;
    if (page + 1 < maxPages) await sleep(200);
  }
  return rows;
}

function etYyyymmdd(offsetDays = 0) {
  const t = Date.now() + offsetDays * DAY_MS;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(t));
  const o = {};
  for (const p of parts) {
    if (p.type !== "literal") o[p.type] = p.value;
  }
  return `${o.year}${o.month}${o.day}`;
}

function rememberKiwoom(code, pack, barAt, quoteAt) {
  kiwoomBarCache.set(code, { barAt, quoteAt, pack });
  if (kiwoomBarCache.size > 40) kiwoomBarCache.delete(kiwoomBarCache.keys().next().value);
}

async function kiwoomSession(symbol, exchangeHint) {
  if (!KIWOOM_APP_KEY || !symbol) return { bars: [], quote: null };
  const now = Date.now();
  if (now < kiwoomAuthDownUntil) {
    const cached = kiwoomBarCache.get(String(symbol).toUpperCase().split(".")[0]);
    if (cached?.pack) return cached.pack;
    throw new Error(kiwoomDownMsg || "키움 인증 실패");
  }
  const code = String(symbol).toUpperCase().split(".")[0];
  const cached = kiwoomBarCache.get(code);
  const liveQ = liveBoard.get(code);
  const barsOk = cached && now - cached.barAt < 20_000 && cached.pack?.bars?.length;
  const quoteOk = (cached && now - cached.quoteAt < 5_000 && cached.pack?.quote)
    || (liveQ?.quote && now - (liveQ.kwAt || 0) < 3_000);
  if (barsOk && quoteOk) {
    if (liveQ?.quote && cached?.pack) {
      return { ...cached.pack, quote: liveQ.quote };
    }
    return cached?.pack || { bars: cached?.pack?.bars || [], quote: liveQ.quote, exchange: cached?.pack?.exchange };
  }

  const preferred = kiwoomExCache.get(code);
  const exchanges = preferred ? [preferred] : kiwoomExchanges(exchangeHint);
  let lastError = null;

  for (const stex_tp of exchanges) {
    try {
      const needBars = !barsOk && now >= kiwoomChartDownUntil;
      let chartErr = null;
      const [chart, quoteRow] = await Promise.all([
        needBars
          ? kiwoomPost("/api/us/chart", "usa06011", {
            stex_tp,
            stk_cd: code,
            strt_dt: etYyyymmdd(0),
            tic_scope: "1",
            upd_stkpc_tp: "0",
            exrt_appl_tp: "0",
          }).catch((err) => {
            chartErr = err;
            return null;
          })
          : Promise.resolve(null),
        quoteOk
          ? Promise.resolve(null)
          : kiwoomPost("/api/us/mrkcond", "usa20100", { stex_tp, stk_cd: code }),
      ]);
      if (chartErr) {
        const cmsg = String(chartErr.message || "");
        if (/1700|한도/.test(cmsg)) {
          kiwoomChartDownUntil = now + 15_000;
          kiwoomDownMsg = cmsg;
        } else if (!/1903|종목 정보/.test(cmsg)) lastError = chartErr;
      }
      const bars = barsOk
        ? cached.pack.bars
        : kiwoomPerMinuteBars(chart?.result_list);
      const quote = quoteOk
        ? (cached?.pack?.quote || liveQ?.quote)
        : mapKiwoomQuote(quoteRow);
      if (!bars.length && !quote) {
        lastError = new Error(`${code} ${stex_tp} 시세 없음`);
        continue;
      }
      kiwoomExCache.set(code, stex_tp);
      const pack = {
        bars: bars.length ? bars : (cached?.pack?.bars || []),
        quote: quote || cached?.pack?.quote || liveQ?.quote || null,
        exchange: stex_tp,
      };
      rememberKiwoom(
        code,
        pack,
        barsOk || !needBars ? (cached?.barAt || now) : now,
        quoteOk ? (cached?.quoteAt || now) : now,
      );
      return pack;
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || "");
      if (/1700|한도/.test(msg)) {
        kiwoomChartDownUntil = now + 15_000;
        kiwoomDownMsg = msg;
        if (cached?.pack) return cached.pack;
        break;
      }
      if (/토큰|인증|유효하지|권한/.test(msg)) {
        kiwoomAuthDownUntil = now + 20_000;
        kiwoomDownMsg = msg;
        if (cached?.pack) return cached.pack;
        throw err;
      }
    }
  }
  if (cached?.pack) return cached.pack;
  throw lastError || new Error(`${code} 키움 조회 실패`);
}

function mapKiwoomCandle(row) {
  const t = kiwoomBarTime(row);
  const o = signedNum(row.open_pric);
  const h = signedNum(row.high_pric);
  const l = signedNum(row.low_pric);
  const c = signedNum(row.cur_prc);
  const vBar = signedNum(row.trde_qty) || signedNum(row.cntr_qty);
  const vAcc = signedNum(row.acc_trde_qty);
  if (t == null || ![o, h, l, c].every((x) => x > 0)) return null;
  return {
    t: Math.floor(t / 60) * 60,
    o,
    h,
    l,
    c,
    v: vBar || vAcc || 0,
    vAcc: vAcc || 0,
  };
}

function kiwoomPerMinuteBars(rows) {
  const bars = [...(rows || [])].map(mapKiwoomCandle).filter(Boolean).sort((a, b) => a.t - b.t);
  if (bars.length < 2) {
    return bars.map(({ vAcc, ...bar }) => bar);
  }
  const positives = bars.map((b) => b.v).filter((v) => v > 0);
  const accBars = bars.filter((b) => b.vAcc > 0).length;
  const barVolHits = bars.filter((b) => b.v > 0 && b.vAcc > 0 && b.v !== b.vAcc).length;
  if (accBars < 2 || barVolHits >= Math.min(3, positives.length)) {
    return bars.map(({ vAcc, ...bar }) => bar);
  }
  let rising = 0;
  for (let i = 1; i < positives.length; i += 1) {
    if (positives[i] >= positives[i - 1]) rising += 1;
  }
  const last = positives.at(-1) || 0;
  const first = positives[0] || 0;
  const looksCumulative = positives.length >= 3
    && last >= first * 3
    && rising >= Math.max(1, positives.length - 1) * 0.75;
  if (!looksCumulative) {
    return bars.map(({ vAcc, ...bar }) => bar);
  }
  let prev = 0;
  return bars.map((b) => {
    const acc = b.vAcc || b.v || 0;
    const v = acc >= prev ? acc - prev : acc;
    prev = acc;
    return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v };
  });
}

function kiwoomMarketCap(mac, shares, last) {
  if (!(mac > 0)) return null;
  const asUsd = mac;
  const asThousand = mac * 1000;
  const implied = shares > 0 && last > 0 ? shares * last : null;
  if (implied > 0) {
    const dUsd = Math.abs(Math.log(asUsd / implied));
    const dThou = Math.abs(Math.log(asThousand / implied));
    return dThou <= dUsd ? asThousand : asUsd;
  }
  return asThousand;
}

function mapKiwoomQuote(row) {
  if (!row) return null;
  const last = signedNum(row.cur_prc);
  if (!(last > 0)) return null;
  const volume = signedNum(row.acc_trde_qty) || null;
  const turnover = signedNum(row.trde_prica) || signedNum(row.acc_trde_prica) || null;
  const prevClose = signedNum(row.base_close_pric);
  const fluRt = signedNum(row.flu_rt);
  const shares = signedNum(row.stk_cnt);
  const marketCap = kiwoomMarketCap(signedNum(row.mac), shares, last);
  return {
    last,
    volume,
    turnover: turnover || null,
    prevClose: prevClose > 0 ? prevClose : null,
    fluRt: Number.isFinite(fluRt) ? fluRt : null,
    shares: shares > 0 ? shares : null,
    marketCap,
    bid: signedNum(row.buy_bid1 || row.bid_uv || row.buy_uv) || null,
    ask: signedNum(row.sel_bid1 || row.ask_uv || row.sel_uv) || null,
  };
}

let kiwoomRankCache = { at: 0, rows: [], basis: "" };
const quoteTape = new Map();
const liveBoard = new Map();
const rthCloseBySym = new Map();
const priceTape = new Map();
const volumeTape = new Map();
let liveKickBusy = false;
let kiwoomQuoteCursor = 0;
let boardEtDay = "";
let lastChartSymbol = "";
let livePumpStarted = false;

function etDateKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

function rememberRthClose(symbol, px) {
  const code = String(symbol || "").toUpperCase().split(".")[0];
  if (!code || !(px > 0)) return;
  rthCloseBySym.set(code, px);
  if (rthCloseBySym.size > 400) rthCloseBySym.delete(rthCloseBySym.keys().next().value);
}

function resetUsBoardIfNewEtDay() {
  const day = etDateKey();
  if (!boardEtDay) {
    boardEtDay = day;
    return false;
  }
  if (day === boardEtDay) return false;
  boardEtDay = day;
  kiwoomRankCache = { at: 0, rows: [], basis: "" };
  minuteCache = { at: 0, rows: [] };
  liveBoard.clear();
  quoteTape.clear();
  rthCloseBySym.clear();
  priceTape.clear();
  volumeTape.clear();
  kiwoomQuoteCursor = 0;
  return true;
}

function clockMinute() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function rememberVolumeTape(symbol, volume) {
  const code = String(symbol || "").toUpperCase().split(".")[0];
  if (!code) return 0;
  const minute = clockMinute();
  const cur = volumeTape.get(code);
  if (!cur || cur.minute !== minute) {
    if (!(volume > 0) && !(cur?.lastVol > 0)) return 0;
    const startVol = cur?.lastVol > 0 ? cur.lastVol : volume;
    const lastVol = volume > 0 ? volume : startVol;
    volumeTape.set(code, { minute, startVol, lastVol });
    return lastVol > startVol ? Math.round(lastVol - startVol) : 0;
  }
  if (volume > 0) cur.lastVol = Math.max(cur.lastVol || 0, volume);
  return cur.lastVol > cur.startVol ? Math.round(cur.lastVol - cur.startVol) : 0;
}

function minuteVolAdd(symbol, volume) {
  return rememberVolumeTape(symbol, volume);
}

function compareLiveRank(a, b) {
  const a1 = Number.isFinite(Number(a.minuteChangePct)) ? Number(a.minuteChangePct) : 0;
  const b1 = Number.isFinite(Number(b.minuteChangePct)) ? Number(b.minuteChangePct) : 0;
  if (b1 !== a1) return b1 - a1;
  return (b.minuteVolAdd ?? -1) - (a.minuteVolAdd ?? -1)
    || (b.volDelta ?? -1) - (a.volDelta ?? -1)
    || (b.volSurgePct ?? -1) - (a.volSurgePct ?? -1);
}

function rememberPriceTape(symbol, px) {
  const code = String(symbol || "").toUpperCase().split(".")[0];
  if (!code || !(px > 0)) return;
  const now = Date.now();
  const arr = priceTape.get(code) || [];
  if (!arr.length) arr.push({ t: now - 8_000, px });
  const last = arr.at(-1);
  if (last && now - last.t < 400 && Math.abs(last.px - px) < 1e-12) {
    priceTape.set(code, arr);
    return;
  }
  arr.push({ t: now, px });
  priceTape.set(code, arr.filter((p) => now - p.t < 3 * 60 * 1000).slice(-180));
}

function minuteChangeFromTape(symbol, px) {
  const code = String(symbol || "").toUpperCase().split(".")[0];
  if (!code || !(px > 0)) return null;
  const arr = priceTape.get(code) || [];
  if (!arr.length) return null;
  const now = Date.now();
  const lastPx = arr.at(-1)?.px || px;
  const target = now - 60_000;
  let prev = null;
  for (const p of arr) {
    if (p.t <= target) prev = p;
  }
  if (!prev?.px) {
    prev = arr[0];
    if (!prev?.px || now - prev.t < 8_000) return null;
  }
  if (!(prev.px > 0)) return null;
  return Number((((lastPx - prev.px) / prev.px) * 100).toFixed(2));
}

function pctFromClose(price, close) {
  if (!(close > 0) || !(price > 0)) return null;
  return Number((((price - close) / close) * 100).toFixed(2));
}

async function kiwoomQuoteOnly(symbol, exchangeHint) {
  if (!KIWOOM_APP_KEY || !symbol) return null;
  if (Date.now() < kiwoomAuthDownUntil) return liveBoard.get(String(symbol).toUpperCase())?.quote || null;
  const code = String(symbol).toUpperCase().split(".")[0];
  const hit = liveBoard.get(code);
  if (hit?.quote && Date.now() - (hit.kwAt || 0) < 1000) return hit.quote;
  const stex_tp = kiwoomExCache.get(code) || kiwoomExchanges(exchangeHint)[0];
  try {
    const row = await kiwoomPost("/api/us/mrkcond", "usa20100", { stex_tp, stk_cd: code });
    const quote = mapKiwoomQuote(row);
    if (quote) kiwoomExCache.set(code, stex_tp);
    return quote;
  } catch {
    return hit?.quote || null;
  }
}

function sessionVolumeStats(volume, avgVol) {
  if (!(avgVol > 0) || volume == null || !Number.isFinite(Number(volume))) {
    return { volSurgePct: null, volDelta: null, relVol: null };
  }
  const vol = Number(volume);
  const avg = Number(avgVol);
  return {
    volSurgePct: Number((((vol - avg) / avg) * 100).toFixed(2)),
    volDelta: Math.round(vol - avg),
    relVol: Number((vol / avg).toFixed(2)),
  };
}

function rememberLiveBoard(symbol, patch) {
  const code = String(symbol || "").toUpperCase();
  if (!code) return;
  const cur = liveBoard.get(code) || {};
  liveBoard.set(code, { ...cur, ...patch, at: Date.now() });
  if (patch.price > 0) rememberPriceTape(code, patch.price);
  if (patch.volume > 0) rememberVolumeTape(code, patch.volume);
  if (liveBoard.size > 200) liveBoard.delete(liveBoard.keys().next().value);
}

function overlayLiveBoard(rows) {
  const session = tapeSessionNow();
  return rows.map((row) => {
    const live = liveBoard.get(row.symbol);
    const price = live?.price || row.price;
    const liveVol = live?.volume > 0 ? live.volume : null;
    const volume = liveVol != null ? Math.max(liveVol, row.volume || 0) : row.volume;
    const turnover = price > 0 && volume > 0
      ? price * volume
      : (live?.turnover || row.turnover || null);
    const avgVol = row.avgVol || live?.avgVol || null;
    const stats = sessionVolumeStats(volume, avgVol);
    const rthClose = live?.rthClose || rthCloseBySym.get(row.symbol);
    if (price > 0) rememberPriceTape(row.symbol, price);
    let dayChangePct = row.dayChangePct ?? row.changePct ?? null;
    if (session === "PRE" || session === "POST" || (session === "CLOSED" && rthClose > 0)) {
      dayChangePct = pctFromClose(price, rthClose) ?? live?.fluRt ?? live?.postChangePct ?? dayChangePct;
    }
    const min1 = minuteChangeFromTape(row.symbol, price)
      ?? live?.minuteChangePct
      ?? row.minuteChangePct
      ?? null;
    if (min1 != null) {
      const cur = liveBoard.get(row.symbol) || {};
      liveBoard.set(row.symbol, { ...cur, minuteChangePct: min1, at: cur.at || Date.now() });
    }
    const add = minuteVolAdd(row.symbol, liveVol ?? (volume > 0 ? volume : null));
    const relVol = stats.relVol ?? row.relVol;
    return {
      ...row,
      price,
      volume,
      turnover,
      avgVol,
      volSurgePct: stats.volSurgePct ?? row.volSurgePct,
      volDelta: add,
      relVol,
      minuteVolAdd: add || null,
      dayChangePct,
      changePct: dayChangePct,
      minuteChangePct: min1,
      heat: minuteHeat(min1, relVol ?? row.minuteRelVol),
    };
  });
}

async function applyYahooLive(rows) {
  const session = tapeSessionNow();
  const quotes = await yahooQuotesBatch(rows.slice(0, 40).map((r) => r.symbol));
  for (const row of rows) {
    const q = quotes.get(row.symbol);
    if (!q) continue;
    const prev = liveBoard.get(row.symbol) || {};
    if (session === "REGULAR" && q.last > 0) rememberRthClose(row.symbol, q.last);
    if ((session === "POST" || session === "CLOSED") && q.regularMarketPrice > 0) {
      rememberRthClose(row.symbol, q.regularMarketPrice);
    }
    rememberLiveBoard(row.symbol, {
      price: q.last || prev.price,
      avgVol: q.avgVol || prev.avgVol,
      rthClose: rthCloseBySym.get(row.symbol) || q.regularMarketPrice || prev.rthClose,
      postChangePct: q.postMarketChangePercent,
      ...(q.volume > 0 && !prev.kwAt ? { volume: q.volume } : {}),
    });
  }
}

function pickLiveQuoteBatch(rows) {
  if (!rows?.length) return [];
  const hotN = Math.min(15, rows.length);
  const hot = rows.slice(0, hotN);
  const a = hot[kiwoomQuoteCursor % hotN];
  const b = hot[(kiwoomQuoteCursor * 5 + 3) % hotN];
  const c = rows[kiwoomQuoteCursor % rows.length];
  kiwoomQuoteCursor += 1;
  const seen = new Set();
  return [a, b, c].filter((row) => {
    if (!row?.symbol || seen.has(row.symbol)) return false;
    seen.add(row.symbol);
    return true;
  });
}

function kickKiwoomLive(rows) {
  if (liveKickBusy || !KIWOOM_APP_KEY || Date.now() < kiwoomAuthDownUntil) return;
  if (!rows?.length) return;
  const batch = pickLiveQuoteBatch(rows);
  if (!batch.length) return;
  liveKickBusy = true;
  mapLimit(batch, 3, async (row) => {
    try {
      const q = await kiwoomQuoteOnly(row.symbol, row.exchange);
      if (!q) return;
      const prev = liveBoard.get(row.symbol) || {};
      const price = q.last || prev.price || row.price;
      const volume = q.volume || prev.volume || row.volume;
      const turnover = q.turnover || prev.turnover;
      const session = tapeSessionNow();
      if (q.prevClose > 0) rememberRthClose(row.symbol, q.prevClose);
      if (session === "REGULAR" && price > 0) rememberRthClose(row.symbol, price);
      rememberLiveBoard(row.symbol, {
        price,
        volume,
        turnover,
        quote: q,
        fluRt: q.fluRt,
        kwAt: Date.now(),
        rthClose: rthCloseBySym.get(row.symbol) || q.prevClose || prev.rthClose,
      });
    } catch {}
  }).finally(() => {
    liveKickBusy = false;
  });
}

async function liveBoardRows(rows) {
  if (!rows?.length) return rows;
  if (!KIWOOM_APP_KEY || Date.now() < kiwoomAuthDownUntil) {
    await applyYahooLive(rows).catch(() => {});
  }
  kickKiwoomLive(rows);
  startKiwoomLivePump();
  return overlayLiveBoard(rows);
}

function startKiwoomLivePump() {
  if (livePumpStarted) return;
  livePumpStarted = true;
  setInterval(() => {
    const rows = [...(minuteCache.rows || [])];
    if (lastChartSymbol && !rows.some((r) => r.symbol === lastChartSymbol)) {
      rows.unshift({ symbol: lastChartSymbol });
    }
    if (rows.length) kickKiwoomLive(rows);
  }, 1000);
}

function kiwoomMinuteTape(symbol, quoteVol, barTs) {
  if (!(quoteVol > 0) || !symbol) return 0;
  const minute = Math.floor(barTs / 60) * 60;
  const code = String(symbol).toUpperCase().split(".")[0];
  const cur = quoteTape.get(code);
  if (!cur) {
    quoteTape.set(code, { minute, last: quoteVol, acc: 0, byMin: new Map() });
    return 0;
  }
  if (cur.minute !== minute) {
    if (cur.acc > 0) cur.byMin.set(cur.minute, cur.acc);
    const add = Math.max(0, quoteVol - cur.last);
    cur.minute = minute;
    cur.last = quoteVol;
    cur.acc = add;
    if (add > 0) cur.byMin.set(minute, add);
    return add;
  }
  const add = Math.max(0, quoteVol - cur.last);
  cur.last = quoteVol;
  cur.acc += add;
  cur.byMin.set(minute, cur.acc);
  return cur.acc;
}

function applyTapeHistory(bars, symbol) {
  const code = String(symbol || "").toUpperCase().split(".")[0];
  const taped = quoteTape.get(code)?.byMin;
  if (!taped?.size) return bars;
  return bars.map((b) => {
    const extra = taped.get(Math.floor(b.t / 60) * 60) || 0;
    return extra > 0 ? { ...b, v: Math.max(b.v || 0, extra) } : b;
  });
}

function allocateSessionVolume(bars, sessionVol) {
  if (!(sessionVol > 0) || !bars?.length) return bars;
  const known = bars.reduce((s, b) => s + (b.v || 0), 0);
  if (known >= sessionVol * 0.15) return bars;
  const weights = bars.map((b) => {
    if (b.flat) return 0;
    const range = Math.max(b.h - b.l, Math.abs(b.c - b.o));
    return range > 0 ? range : 0;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) {
    const live = bars.filter((b) => !b.flat);
    const pool = live.length ? live : bars.slice(-30);
    const each = Math.max(1, Math.round(sessionVol / Math.max(pool.length, 1)));
    const times = new Set(pool.map((b) => b.t));
    return bars.map((b) => (times.has(b.t) ? { ...b, v: Math.max(b.v || 0, each) } : b));
  }
  return bars.map((b, i) => {
    if (!weights[i]) return b;
    return { ...b, v: Math.max(b.v || 0, Math.round(sessionVol * (weights[i] / sum))) };
  });
}

function rankExchange(tp) {
  const v = String(tp || "").toUpperCase();
  if (v === "1" || v === "NY") return "NYSE";
  if (v === "2" || v === "ND") return "NASDAQ";
  if (v === "3" || v === "NA") return "AMEX";
  return "US";
}

function mapKiwoomRankRow(row, kind) {
  const symbol = String(row?.stk_cd || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) return null;
  const price = signedNum(row.cur_prc);
  const changePct = signedNum(row.flu_rt);
  const volume = signedNum(row.now_trde_qty) || signedNum(row.acc_trde_qty);
  const prevVol = signedNum(row.prev_trde_qty);
  const surge = signedNum(row.sdnin_rt) || signedNum(row.pred_rt);
  const volSurgePct = Number.isFinite(surge)
    ? surge
    : (prevVol && volume ? ((volume - prevVol) / prevVol) * 100 : NaN);
  let volDelta = signedNum(row.sdnin_qty) || (volume && prevVol ? volume - prevVol : 0);
  if (!volDelta && volume > 0 && Number.isFinite(volSurgePct) && volSurgePct !== -100) {
    volDelta = Math.round(volume - volume / (1 + volSurgePct / 100));
  }
  const turnover = signedNum(row.trde_prica) || (price && volume ? price * volume : 0);
  const relVol = prevVol && volume ? volume / prevVol : (volSurgePct ? 1 + volSurgePct / 100 : null);
  const avgVol = prevVol
    || (volume > 0 && Number.isFinite(volSurgePct) && volSurgePct !== -100
      ? volume / (1 + volSurgePct / 100)
      : null);
  return {
    symbol,
    name: row.stk_nm || row.stk_enm || symbol,
    exchange: rankExchange(row.stex_tp),
    price: price || null,
    change: signedNum(row.pred_pre) || null,
    dayChangePct: Number.isFinite(changePct) ? changePct : null,
    minuteChangePct: null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    volume: volume || null,
    turnover: turnover || null,
    avgVol: avgVol > 0 ? avgVol : null,
    volDelta: Number.isFinite(volDelta) ? volDelta : null,
    volSurgePct: Number.isFinite(volSurgePct) ? Number(volSurgePct.toFixed(2)) : null,
    relVol: relVol != null ? Number(relVol.toFixed(2)) : null,
    minuteRelVol: null,
    heat: null,
    source: kind,
    kiwoomRank: null,
  };
}

const KIWOOM_SURGE_BODY = {
  stex_tp: "0",
  inds_cd: "",
  tm: "5",
  stk_tp: "1",
  stk_cnd: "0",
  pric_cnd: "0",
  trde_prica_cnd: "0",
  trde_qty_tp: "0",
};

const KIWOOM_RANK_BODY = {
  stex_tp: "0",
  inds_cd: "",
  stk_tp: "1",
  trde_qty_tp: "0",
  qry_tp: "0",
  stk_cnd: "2",
  pric_cnd: "0",
  trde_prica_cnd: "0",
};

async function kiwoomVolumeBoard() {
  if (!KIWOOM_APP_KEY) return { at: 0, rows: [], basis: "" };
  if (Date.now() < kiwoomAuthDownUntil) {
    return kiwoomRankCache.rows.length ? kiwoomRankCache : { at: 0, rows: [], basis: "" };
  }
  if (Date.now() - kiwoomRankCache.at < 12_000 && kiwoomRankCache.rows.length) {
    return kiwoomRankCache;
  }
  let raw = [];
  let basis = "";
  try {
    raw = await kiwoomListPages("/api/us/stkinfo", "usa20520", KIWOOM_SURGE_BODY, 3);
    if (raw.length) basis = "kiwoom-surge";
  } catch (err) {
    console.warn("kiwoom usa20520:", err.message);
  }
  if (!raw.length) {
    try {
      raw = await kiwoomListPages("/api/us/rkinfo", "usa20530", KIWOOM_RANK_BODY, 2);
      if (raw.length) basis = "kiwoom-volume-up50";
    } catch (err) {
      console.warn("kiwoom usa20530:", err.message);
    }
  }
  if (!raw.length) {
    try {
      raw = await kiwoomListPages("/api/us/rkinfo", "usa20530", { ...KIWOOM_RANK_BODY, stk_cnd: "0", stk_tp: "0" }, 2);
      if (raw.length) basis = "kiwoom-volume";
    } catch (err) {
      console.warn("kiwoom usa20530 fallback:", err.message);
    }
  }
  const bySym = new Map();
  for (const mapped of raw.map((r) => mapKiwoomRankRow(r, "surge")).filter(Boolean)) {
    const cur = bySym.get(mapped.symbol);
    if (!cur || (mapped.volSurgePct ?? -1) > (cur.volSurgePct ?? -1)) {
      bySym.set(mapped.symbol, mapped);
    }
  }
  let rows = [...bySym.values()].filter((r) => (r.volSurgePct ?? 0) > 0);
  const gainers = rows.filter(isGainerName);
  if (gainers.length) rows = gainers;
  rows.sort((a, b) => (b.volSurgePct ?? -1) - (a.volSurgePct ?? -1) || (b.volume ?? 0) - (a.volume ?? 0));
  rows.forEach((row, i) => {
    row.kiwoomRank = i;
  });
  const pack = { at: Date.now(), rows, basis };
  if (rows.length) kiwoomRankCache = pack;
  return pack;
}

function blendMinuteBars(yahooBars, extraBars) {
  const byMin = new Map();
  for (const bar of yahooBars || []) byMin.set(Math.floor(bar.t / 60) * 60, { ...bar });
  for (const bar of extraBars || []) {
    const t = Math.floor(bar.t / 60) * 60;
    const cur = byMin.get(t);
    if (!cur) {
      byMin.set(t, { ...bar, t });
      continue;
    }
    const volume = Math.max(cur.v || 0, bar.v || 0);
    if ((cur.v === 0 || cur.flat) && bar.c != null) {
      byMin.set(t, { ...bar, t, v: volume, flat: false });
    } else {
      byMin.set(t, { ...cur, v: volume });
    }
  }
  return [...byMin.values()].sort((a, b) => a.t - b.t);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  if (!res.ok) throw new Error(`요청 실패 ${res.status}`);
  return res.text();
}

async function naverSearch(query) {
  const url =
    "https://m.stock.naver.com/front-api/search/autoComplete?" +
    new URLSearchParams({ query, target: "stock" });
  const data = await fetchJson(url);
  return (data.result?.items || [])
    .filter((item) => item.category === "stock" && item.code && !item.isEtf)
    .map((item) => {
      const kosdaq = String(item.typeCode || "").toUpperCase().includes("KOSDAQ");
      return {
        symbol: `${item.code}.${kosdaq ? "KQ" : "KS"}`,
        name: item.name,
        exchange: item.typeName || "",
        type: "EQUITY",
      };
    });
}

async function yahooSearch(query) {
  if (hasHangul(query)) return { quotes: [], news: [] };
  const url =
    "https://query1.finance.yahoo.com/v1/finance/search?" +
    new URLSearchParams({
      q: query,
      quotesCount: "10",
      newsCount: "20",
      enableFuzzyQuery: "false",
      quotesQueryId: "tss_match_phrase_query",
    });
  const data = await fetchJson(url);
  const quotes = (data.quotes || [])
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange || "",
      type: q.quoteType,
    }));
  const news = (data.news || []).map((n) => toNews({
    title: n.title,
    url: n.link,
    publisher: n.publisher || "Yahoo Finance",
    publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    source: "yahoo",
  }));
  return { quotes, news };
}

function pickBestQuote(quotes) {
  if (!quotes.length) return null;
  const score = (q) => {
    const ex = `${q.exchange} ${q.symbol}`.toUpperCase();
    if (/\.(KS|KQ)$/.test(q.symbol)) return 1;
    if (ex.includes("OTC") || ex.includes("PNK")) return 2;
    if (ex.includes("NASDAQ") || ex.includes("NMS") || ex.includes("NGM")) return 10;
    if (ex.includes("NYSE") || ex.includes("NYQ")) return 9;
    if (ex.includes("AMEX") || ex.includes("ARCA")) return 7;
    return 5;
  };
  return [...quotes].sort((a, b) => score(b) - score(a))[0];
}

function toNews(item) {
  return {
    title: item.title,
    url: item.url,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
    source: item.source,
    pass: Boolean(item.pass),
  };
}

function newsChannel(item) {
  const p = `${item.publisher || ""} ${item.url || ""} ${item.source || ""}`.toLowerCase();
  if (p.includes("stock titan") || p.includes("stocktitan")) return "Stock Titan";
  if (p.includes("reuters")) return "Reuters";
  if (p.includes("bloomberg")) return "Bloomberg";
  if (p.includes("cnbc")) return "CNBC";
  if (p.includes("yahoo")) return "Yahoo";
  if (p.includes("marketwatch")) return "MarketWatch";
  if (p.includes("benzinga")) return "Benzinga";
  if (p.includes("seeking")) return "Seeking Alpha";
  if (p.includes("thestreet") || p.includes("the street")) return "TheStreet";
  if (p.includes("zacks")) return "Zacks";
  if (p.includes("wsj") || p.includes("wall street")) return "WSJ";
  if (p.includes("barron")) return "Barron's";
  if (p.includes("globe") || p.includes("prnewswire") || p.includes("pr news") || p.includes("businesswire") || p.includes("accesswire") || item.source === "wires") {
    return "통신사 PR";
  }
  return item.publisher || "기타";
}

function isOverseas(item) {
  const pub = `${item.publisher || ""} ${item.url || ""}`.toLowerCase();
  if (KR_BLOCK.some((k) => pub.includes(k))) return false;
  if (OVERSEAS_PUBLISHERS.some((k) => pub.includes(k))) return true;
  if (["yahoo", "reuters", "cnbc", "stocktitan", "wires", "analysts"].includes(item.source)) return true;
  if (/\.(com|co.uk|com.au)\//i.test(item.url || "") && !/\.(kr)\//i.test(item.url || "")) return true;
  return false;
}

function tickerInText(text, ticker) {
  const raw = String(ticker || "").replace(/\.(KS|KQ)$/i, "");
  if (!raw || raw.length < 1) return false;
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, "i").test(text);
}

function companyCore(name) {
  return String(name || "")
    .replace(/\b(incorporated|corporation|company|limited|holdings|group|class [a-c]|ordinary shares|common stock|inc|corp|ltd|llc|plc|co)\.?/gi, " ")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, words) {
  const hay = String(text || "");
  return words.some((w) => {
    const t = String(w).trim();
    if (!t) return false;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, "i").test(hay);
  });
}

function isEquityNews(item, ticker, name) {
  const title = String(item.title || "");
  const off = hasAny(title, OFF_TOPIC_NEWS);
  const mkt = hasAny(title, STOCK_NEWS);
  const tick = tickerInText(title, ticker);
  const core = companyCore(name);
  const named = core.length >= 4 && tickerInText(title, core);
  if (off && !tick) return false;
  if (off && tick && !mkt && !/10-q|10-k|8-k|form 4|filing|sec/i.test(title)) return false;
  if (tick) return true;
  if (named && mkt) return true;
  return false;
}

async function googleRss(q, source, publisher) {
  const url =
    "https://news.google.com/rss/search?" +
    new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" });
  const xml = await fetchText(url);
  return parseRss(xml).map((item) => toNews({
    ...item,
    source,
    publisher: item.publisher || publisher,
    pass: false,
  }));
}

async function googleOverseasNews(ticker) {
  const sites = [
    "reuters.com", "bloomberg.com", "cnbc.com", "marketwatch.com",
    "wsj.com", "ft.com", "benzinga.com", "yahoo.com",
    "seekingalpha.com", "thestreet.com", "barrons.com", "investing.com",
    "forbes.com", "fortune.com", "businessinsider.com",
  ].map((s) => `site:${s}`).join(" OR ");
  const q = `${ticker} (stock OR shares OR NASDAQ OR NYSE OR earnings OR SEC) (${sites})`;
  return googleRss(q, "google-us", "Google News");
}

async function stockTitanNews(symbol) {
  const ticker = String(symbol || "").replace(/\.(KS|KQ)$/i, "");
  if (!ticker) return [];
  return googleRss(`${ticker} (stock OR shares OR NASDAQ OR NYSE OR SEC OR earnings) site:stocktitan.net`, "stocktitan", "Stock Titan");
}

async function wireNews(ticker) {
  const q = `${ticker} (stock OR shares OR NASDAQ OR earnings OR SEC) (site:globenewswire.com OR site:prnewswire.com OR site:businesswire.com OR site:accesswire.com)`;
  return googleRss(q, "wires", "Press wire");
}

async function analystNews(ticker) {
  const q = `${ticker} (stock OR shares OR earnings) (site:seekingalpha.com OR site:benzinga.com OR site:thestreet.com OR site:marketwatch.com OR site:zacks.com)`;
  return googleRss(q, "analysts", "Analyst");
}

async function yahooHeadlineRss(symbol) {
  const url =
    "https://feeds.finance.yahoo.com/rss/2.0/headline?" +
    new URLSearchParams({ s: symbol, region: "US", lang: "en-US" });
  const xml = await fetchText(url);
  return parseRss(xml).map((item) => toNews({ ...item, publisher: item.publisher || "Yahoo Finance", source: "yahoo-rss" }));
}

async function reutersRss(ticker) {
  const xml = await fetchText(
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: `${ticker} (stock OR shares OR earnings) site:reuters.com`,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    }),
  );
  return parseRss(xml).map((item) => toNews({ ...item, source: "reuters" }));
}

async function cnbcRss(ticker) {
  const xml = await fetchText(
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: `${ticker} (stock OR shares OR earnings) site:cnbc.com`,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    }),
  );
  return parseRss(xml).map((item) => toNews({ ...item, source: "cnbc" }));
}

function parseRss(xml) {
  const items = [];
  for (const block of xml.split(/<item>/i).slice(1)) {
    const title = decodeXml(inner(block, "title")).replace(/ - [^-]+$/, "").trim();
    const link = decodeXml(inner(block, "link"));
    const pubDate = inner(block, "pubDate");
    const source = decodeXml(inner(block, "source")) || "";
    if (!title) continue;
    items.push({
      title,
      url: link,
      publisher: source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
    });
  }
  return items;
}

function inner(xml, tag) {
  const cdata = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return plain ? plain[1].trim() : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function classify(title) {
  const text = title.toLowerCase();
  let pos = 0;
  let neg = 0;
  const hits = [];
  for (const word of POSITIVE) {
    if (text.includes(word)) {
      pos += 1;
      hits.push(word);
    }
  }
  for (const word of NEGATIVE) {
    if (text.includes(word)) {
      neg += 1;
      hits.push(word);
    }
  }
  let label = "중립";
  if (pos > neg) label = "호재";
  else if (neg > pos) label = "악재";
  else if (pos && neg) label = "혼조";
  return { label, hits: [...new Set(hits)].slice(0, 4) };
}

function withinWeek(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && Date.now() - t <= WEEK_MS && t <= Date.now() + 60 * 60 * 1000;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function newsBias(items) {
  const fresh = items.filter((i) => i.fresh);
  const pool = fresh.length ? fresh : items;
  const pos = pool.filter((i) => i.label === "호재").length;
  const neg = pool.filter((i) => i.label === "악재").length;
  if (!pool.length) return "재료 없음";
  if (neg >= pos + 2 && neg >= 2) return "악재 우세";
  if (pos >= neg + 1 && pos > 0) return "호재 우세";
  if (pos && neg) return "혼조";
  return "중립";
}

function rawNum(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value.raw != null) return Number(value.raw);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function packQuote(p) {
  if (!p) return null;
  const state = p.marketState || "";
  const pre = /PRE/.test(state) && !/POST/.test(state);
  const post = /POST/.test(state);
  const live = pre
    ? rawNum(p.preMarketPrice)
    : post
      ? rawNum(p.postMarketPrice)
      : rawNum(p.regularMarketPrice ?? p.last);
  return {
    last: live ?? rawNum(p.regularMarketPrice ?? p.last),
    bid: rawNum(p.bid),
    ask: rawNum(p.ask),
    bidSize: rawNum(p.bidSize),
    askSize: rawNum(p.askSize),
    avgVol: rawNum(p.averageDailyVolume3Month) || rawNum(p.averageDailyVolume10Day),
    volume: pre
      ? (rawNum(p.preMarketVolume) || rawNum(p.regularMarketVolume))
      : post
        ? (rawNum(p.postMarketVolume) || rawNum(p.regularMarketVolume))
        : rawNum(p.regularMarketVolume),
    marketState: state,
    preMarketPrice: rawNum(p.preMarketPrice),
    postMarketPrice: rawNum(p.postMarketPrice),
    regularMarketPrice: rawNum(p.regularMarketPrice ?? p.last),
    postMarketChangePercent: rawNum(p.postMarketChangePercent),
    preMarketChangePercent: rawNum(p.preMarketChangePercent),
    marketCap: rawNum(p.marketCap),
    shares: rawNum(p.sharesOutstanding) || rawNum(p.impliedSharesOutstanding),
  };
}

async function yahooQuotesBatch(symbols) {
  const list = [...new Set((symbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean))].slice(0, 40);
  if (!list.length) return new Map();
  const tryOnce = async () => {
    const data = await yahooJson(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list.join(","))}`,
    );
    const out = new Map();
    for (const row of data.quoteResponse?.result || []) {
      const packed = packQuote(row);
      const symbol = String(row.symbol || "").toUpperCase();
      if (packed && symbol) out.set(symbol, packed);
    }
    return out;
  };
  try {
    return await tryOnce();
  } catch {
    yahooAuth = { cookie: "", crumb: "", at: 0 };
    try {
      return await tryOnce();
    } catch {
      return new Map();
    }
  }
}

async function yahooQuote(symbol) {
  const tryOnce = async () => {
    const data = await yahooJson(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
    );
    return packQuote(data.quoteResponse?.result?.[0]);
  };
  try {
    return await tryOnce();
  } catch {
    yahooAuth = { cookie: "", crumb: "", at: 0 };
    try {
      return await tryOnce();
    } catch {
      return null;
    }
  }
}

function executableLong(quote, fallback) {
  const last = quote?.last ?? fallback;
  const bid = quote?.bid > 0 ? quote.bid : null;
  const ask = quote?.ask > 0 ? quote.ask : null;
  const state = quote?.marketState || "";
  const preOpen = /PRE/.test(state);
  const rthOpen = /REGULAR/.test(state);
  const open = rthOpen || preOpen;
  const spread = bid != null && ask != null ? Math.abs(ask - bid) : null;
  const spreadPct = spread != null && last ? (spread / last) * 100 : null;
  const inverted = bid != null && ask != null && ask < bid;
  const wideLimit = preOpen ? 3 : 1;
  const wide = spreadPct != null && spreadPct > wideLimit;
  if (open && inverted) {
    return {
      price: roundPx(last),
      how: "last",
      executable: true,
      bid: roundPx(bid),
      ask: roundPx(ask),
      spread: roundPx(spread),
      reason: `호가 역전(지연). 시장가 ${roundPx(last)}로 매수`,
    };
  }
  if (open && ask != null) {
    return {
      price: roundPx(ask),
      how: "ask",
      executable: true,
      bid: roundPx(bid),
      ask: roundPx(ask),
      spread: roundPx(spread),
      reason: wide
        ? `${preOpen ? "프장 " : ""}스프레드 ${spreadPct.toFixed(2)}%. ASK ${roundPx(ask)} 지정가`
        : `${preOpen ? "프장 ASK" : "지금 ASK"} ${roundPx(ask)}에 매수 (bid ${roundPx(bid ?? last)}, 스프레드 ${roundPx(spread)})`,
    };
  }
  if (open && last != null) {
    return {
      price: roundPx(last),
      how: "last",
      executable: true,
      bid: roundPx(bid),
      ask: roundPx(ask),
      spread: roundPx(spread),
      reason: `호가 없음. 시장가 기준 ${roundPx(last)}${preOpen ? " (프장)" : ""}`,
    };
  }
  return {
    price: roundPx(last),
    how: "last",
    executable: false,
    bid: roundPx(bid),
    ask: roundPx(ask),
    spread: roundPx(spread),
    reason: `장 외(${quote?.marketState || "-"}). 체결 대기. 참고 ${roundPx(last)}`,
  };
}

async function yahooChart(symbol, interval, range) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=${interval}&range=${range}&includePrePost=true&region=US&lang=en-US`;
  const data = await fetchJson(url);
  return data.chart?.result?.[0] || null;
}

function barsFromChart(chart) {
  const ts = chart.timestamp || [];
  const q = chart.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i += 1) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i] || 0;
    if ([o, h, l, c].some((x) => x == null)) continue;
    bars.push({ t: ts[i], o, h, l, c, v });
  }
  return bars;
}

function sessionStart(chart) {
  return chart.meta?.currentTradingPeriod?.regular?.start
    || chart.meta?.tradingPeriods?.[0]?.[0]?.start
    || null;
}

function macdValue(closes) {
  if (closes.length < 26) return { macd: null, signal: null, hist: null };
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const signal = emaSeries(line, 9);
  const macd = line.at(-1);
  const sig = signal.at(-1);
  return { macd, signal: sig, hist: macd - sig };
}

function stochK(bars, period = 14) {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  const hh = Math.max(...slice.map((b) => b.h));
  const ll = Math.min(...slice.map((b) => b.l));
  if (hh === ll) return 50;
  return ((bars.at(-1).c - ll) / (hh - ll)) * 100;
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  let prev = values[0];
  const out = [];
  for (const value of values) {
    prev = value * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsiValue(closes, period = 14) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atrValue(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prev = bars[i - 1].c;
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - prev), Math.abs(bars[i].l - prev));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function clock(unix, timeZone) {
  return new Date(unix * 1000).toLocaleTimeString("ko-KR", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionClock(start, end, kr) {
  const et = kr ? "Asia/Seoul" : "America/New_York";
  const kst = "Asia/Seoul";
  return {
    openEt: clock(start, et),
    closeEt: clock(end, et),
    openKst: clock(start, kst),
    closeKst: clock(end, kst),
    tzLabel: kr ? "KRX" : "US ET",
  };
}

function buyWindow(now, start, end, kr, preStart, preEnd) {
  const observeEnd = start + 15 * 60;
  const flattenStart = end - 30 * 60;
  const lunchStart = start + 2 * 60 * 60;
  const lunchEnd = start + 4.5 * 60 * 60;
  const clocks = sessionClock(start, end, kr);
  const slots = kr
    ? [
      { name: "시초 15분 관측", start, end: observeEnd, buy: false, mode: "none" },
      { name: "본장 단타", start: observeEnd, end: flattenStart, buy: true, mode: "full" },
      { name: "마감 전 청산", start: flattenStart, end, buy: false, mode: "none" },
    ]
    : [];

  if (!kr && preStart && preEnd && preEnd > preStart) {
    const preObserve = preStart + 15 * 60;
    const preCut = Math.max(preEnd - 20 * 60, preObserve);
    slots.push(
      { name: "프장 15분 관측 (PMH)", start: preStart, end: preObserve, buy: false, mode: "none" },
      { name: "프장 단타", start: preObserve, end: preCut, buy: true, mode: "pre" },
      { name: "정규 직전 청산", start: preCut, end: preEnd, buy: false, mode: "none" },
    );
  }
  if (!kr && start && end) {
    slots.push(
      { name: "시초 15분 관측 (OR)", start, end: observeEnd, buy: false, mode: "none" },
      { name: "정규 보조 (눌림·VWAP)", start: observeEnd, end: lunchStart, buy: true, mode: "pullback" },
      { name: "점심 금지", start: lunchStart, end: lunchEnd, buy: false, mode: "none" },
      { name: "오후 보조 (눌림만)", start: lunchEnd, end: flattenStart, buy: true, mode: "pullback" },
      { name: "마감 30분 청산만", start: flattenStart, end, buy: false, mode: "none" },
    );
  }

  let current = { name: "장 외", buy: false, mode: "none", note: "프장·정규 밖에서 신규 매수하지 않습니다." };
  if (!kr && preStart && now < preStart) {
    current = { name: "프장 전", buy: false, mode: "none", note: `프장 ${clock(preStart, "Asia/Seoul")} KST 시작. 주력은 프리마켓 단타입니다.` };
  } else if (now >= end) {
    current = { name: "장 마감", buy: false, mode: "none", note: "당일 포지션은 이미 청산했어야 합니다." };
  } else {
    const hit = slots.find((s) => now >= s.start && now < s.end);
    if (hit) {
      current = {
        name: hit.name,
        buy: hit.buy,
        mode: hit.mode || (hit.buy ? "full" : "none"),
        note: hit.mode === "pre"
          ? "프장 주력 구간. PMH 돌파·VWAP 회복·EMA 눌림 중 하나면 진입합니다."
          : hit.mode === "pullback"
            ? "정규는 보조입니다. 돌파 추격 없이 눌림·VWAP만 탑니다."
            : hit.buy
              ? "지금 구간은 단타 매수 시간입니다."
              : hit.name.includes("프장 15분")
                ? "프장 첫 15분은 PMH/PML만 찍고 돌파 확인 전 매수하지 않습니다."
                : hit.name.includes("관측")
                  ? "시초 15분은 OR만 찍고 신규 매수하지 않습니다."
                  : hit.name.includes("직전")
                    ? "정규 개장 직전 20분은 호가 흔들림이 큽니다. 신규 금지, 청산만."
                    : hit.name.includes("점심")
                      ? "점심은 신규 매수하지 않습니다."
                      : "마감 구간은 신규 매수 금지, 전량 청산만 합니다.",
        untilKst: clock(hit.end, "Asia/Seoul"),
      };
    } else if (!kr && preStart && now < start) {
      current = { name: "프장", buy: true, mode: "pre", note: "프장 단타 구간입니다." };
    }
  }

  return {
    ...clocks,
    nowKst: clock(now, "Asia/Seoul"),
    current,
    slots: slots.map((s) => ({
      name: s.name,
      buy: s.buy,
      mode: s.mode || (s.buy ? "full" : "none"),
      kst: `${clock(s.start, "Asia/Seoul")}–${clock(s.end, "Asia/Seoul")}`,
      et: `${clock(s.start, kr ? "Asia/Seoul" : "America/New_York")}–${clock(s.end, kr ? "Asia/Seoul" : "America/New_York")}`,
    })),
  };
}

function applyLiveQuote(bars, meta) {
  const use = bars.map((b) => ({ ...b }));
  const last = use.at(-1);
  if (!last) return use;
  const state = String(meta.marketState || "").toUpperCase();
  const livePx = (/PRE/.test(state) && !/POST/.test(state) && meta.preMarketPrice != null)
    ? meta.preMarketPrice
    : (/POST/.test(state) && meta.postMarketPrice != null)
      ? meta.postMarketPrice
      : (meta.regularMarketPrice ?? meta.last);
  if (livePx == null) return use;
  const now = Math.floor(Date.now() / 1000);
  const liveTs = meta.preMarketTime || meta.postMarketTime || meta.regularMarketTime || now;
  const sameMinute = Math.floor(last.t / 60) === Math.floor(Math.max(liveTs, now) / 60);
  const stale = now - last.t > 120;
  const flatDrift = last.flat && Math.abs(last.c - livePx) > Math.max(livePx * 1e-4, 0.0001);
  if (sameMinute || last.flat) {
    if (sameMinute || flatDrift || stale) {
      last.c = livePx;
      last.h = Math.max(last.h, livePx);
      last.l = Math.min(last.l, livePx);
    }
    return use;
  }
  if (liveTs > last.t || stale) {
    use.push({
      t: Math.floor(Math.max(liveTs, now) / 60) * 60,
      o: last.c,
      h: Math.max(last.c, livePx),
      l: Math.min(last.c, livePx),
      c: livePx,
      v: 0,
    });
  }
  return use;
}

function tapeSessionNow() {
  const mins = nyMinutes(Math.floor(Date.now() / 1000));
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "PRE";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "REGULAR";
  if (mins >= 16 * 60 && mins < 20 * 60) return "POST";
  return "CLOSED";
}

function nyMinutes(ts) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ts * 1000));
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function barSession(t, preStart, start, end, kr) {
  if (kr) {
    if (start && end && t >= start && t < end) return "rth";
    if (preStart && start && t >= preStart && t < start) return "pre";
    if (end && t >= end) return "post";
    return "other";
  }
  const mins = nyMinutes(t);
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "pre";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "rth";
  if (mins >= 16 * 60 && mins < 20 * 60) return "post";
  return "other";
}

function rthCloseFromChart(chart) {
  const close = barsFromChart(chart).filter((b) => barSession(b.t) === "rth").at(-1)?.c;
  return close > 0 ? close : null;
}

function currentUsTapeStart(end) {
  const mins = nyMinutes(end);
  if (mins >= 4 * 60 && mins < 20 * 60) {
    return end - (mins - 4 * 60) * 60;
  }
  return end - 6 * 3600;
}

function fillMinuteGrid(bars, now) {
  const end = Math.floor(now / 60) * 60;
  const sessionFrom = currentUsTapeStart(end);
  const byMin = new Map();
  let seed = null;
  for (const b of bars || []) {
    const t = Math.floor(b.t / 60) * 60;
    if (t < sessionFrom) seed = b.c;
    if (t >= sessionFrom && t <= end) byMin.set(t, { ...b, t });
  }
  const real = [...byMin.values()]
    .filter((b) => !b.flat && (b.v > 0 || b.h !== b.l || b.o !== b.c))
    .sort((a, b) => a.t - b.t);
  const from = Math.max(
    sessionFrom,
    Math.min(real[0]?.t ?? sessionFrom, end - 45 * 60),
  );
  if (seed == null) seed = (byMin.get(from) || real[0] || bars?.[0])?.c;
  const out = [];
  let px = seed;
  for (let t = from; t <= end; t += 60) {
    const hit = byMin.get(t);
    if (hit) {
      out.push(hit);
      px = hit.c;
    } else if (px != null) {
      out.push({ t, o: px, h: px, l: px, c: px, v: 0, flat: true });
    }
  }
  return out.length ? out : bars;
}

function buildIntraday(chart1m, chart1d, quote, extraBars) {
  if (!chart1m) return null;
  const meta = chart1m.meta || {};
  const bars = blendMinuteBars(barsFromChart(chart1m), extraBars);
  const start = sessionStart(chart1m);
  const end = meta.currentTradingPeriod?.regular?.end
    || meta.regularMarketTime
    || (start ? start + 6.5 * 60 * 60 : null);
  const preStart = meta.currentTradingPeriod?.pre?.start || null;
  const preEnd = meta.currentTradingPeriod?.pre?.end || start;
  const now = Math.floor(Date.now() / 1000);
  const inPre = Boolean(preStart && now >= preStart && start && now < start);
  const sessionOpen = inPre ? preStart : start;
  const orWindow = 15 * 60;
  const sessionBars = sessionOpen
    ? bars.filter((b) => {
      if (inPre) return b.t >= preStart && (!start || b.t < start);
      return b.t >= start && (!end || b.t <= end + 120);
    })
    : bars;
  let use = sessionBars.length ? sessionBars : bars;
  if (!use.length) return null;
  use = applyLiveQuote(use, {
    ...meta,
    marketState: quote?.marketState || meta.marketState,
    preMarketPrice: quote?.preMarketPrice ?? meta.preMarketPrice,
    postMarketPrice: quote?.postMarketPrice ?? meta.postMarketPrice,
    regularMarketPrice: quote?.last ?? meta.regularMarketPrice,
  });

  const open = use[0].o;
  const last = use.at(-1);
  const price = quote?.last ?? last.c ?? meta.regularMarketPrice;
  const high = Math.max(...use.map((b) => b.h));
  const low = Math.min(...use.map((b) => b.l));
  const completedVol = use.slice(0, -1).reduce((s, b) => s + b.v, 0);
  const state = String(quote?.marketState || meta.marketState || "").toUpperCase();
  const inPost = /POST/.test(state);
  const inPreState = /PRE/.test(state) && !inPost;
  const quoteVol = rawNum(quote?.volume) || rawNum(meta.regularMarketVolume) || rawNum(meta.preMarketVolume);
  const liveTape = /REGULAR/.test(state) || inPreState;
  const sessionFrom = sessionOpen || use[0].t;
  const sessionTo = inPre && start ? start : (end || last.t + 60);
  const extraLive = (extraBars || []).filter((b) => b.t >= sessionFrom && b.t < sessionTo && b.v > 0);
  const brokerLive = extraLive.some((b) => last.t - b.t <= 180);
  const tapeMin = kiwoomMinuteTape(meta.symbol, quoteVol, last.t);
  if (!brokerLive && liveTape && tapeMin > 0) {
    last.v = Math.max(last.v, tapeMin);
  }
  const volume = quoteVol != null && quoteVol > 0 ? quoteVol : (completedVol + last.v);
  const volBar = liveTape ? last : ([...use].reverse().find((b) => b.v > 0) || last);
  const turnover = use.reduce((s, b) => s + b.c * b.v, 0);
  const lastTurnover = volBar.c * volBar.v;
  const orBars = use.filter((b) => b.t < (sessionOpen || use[0].t) + orWindow);
  const orPool = orBars.length ? orBars : use.slice(0, 15);
  const orh = Math.max(...orPool.map((b) => b.h));
  const orl = Math.min(...orPool.map((b) => b.l));
  const pv = use.reduce((s, b) => s + ((b.h + b.l + b.c) / 3) * b.v, 0);
  const vwap = volume ? pv / volume : price;
  const oscFrom = preStart || sessionOpen || use[0].t;
  let oscUse = bars.filter((b) => b.t >= oscFrom && b.c != null);
  if (oscUse.length < 26) oscUse = bars.filter((b) => b.c != null);
  if (oscUse.length < 15) oscUse = use;
  oscUse = applyLiveQuote(oscUse, {
    ...meta,
    marketState: quote?.marketState || meta.marketState,
    preMarketPrice: quote?.preMarketPrice ?? meta.preMarketPrice,
    postMarketPrice: quote?.postMarketPrice ?? meta.postMarketPrice,
    regularMarketPrice: quote?.last ?? meta.regularMarketPrice,
  });
  const closes = oscUse.map((b) => b.c);
  const ema9 = emaSeries(closes, 9).at(-1);
  const ema21 = emaSeries(closes, 21).at(-1);
  const rsi = rsiValue(closes, 14);
  const rsiPrev = rsiValue(closes.slice(0, -1), 14);
  const atr = atrValue(oscUse, 14);
  const macd = macdValue(closes);
  const macdPrev = macdValue(closes.slice(0, -1));
  const stoch = stochK(oscUse, 14);
  const stochPrev = oscUse.length > 15 ? stochK(oscUse.slice(0, -1), 14) : null;
  const lookback = use.slice(-21, -1);
  const avg1mVol = lookback.length
    ? lookback.reduce((s, b) => s + b.v, 0) / lookback.length
    : last.v;
  const volSpike = avg1mVol && last.v > 0 ? last.v / avg1mVol : null;

  const daily = chart1d ? barsFromChart(chart1d) : [];
  const prev = meta.chartPreviousClose ?? daily.at(-2)?.c ?? open;
  const avgVol = daily.length
    ? daily.slice(0, -1).reduce((s, b) => s + b.v, 0) / Math.max(daily.length - 1, 1)
    : null;
  const elapsedMin = Math.max((last.t - (sessionOpen || use[0].t)) / 60, 1);
  const sessionMin = inPre ? 330 : 390;
  const expectedVol = avgVol ? avgVol * (elapsedMin / sessionMin) : null;
  const relVol = volume > 0
    ? (expectedVol ? volume / expectedVol : (avgVol ? volume / avgVol : null))
    : null;

  const kr = /\.(KS|KQ)$/i.test(meta.symbol || "");
  const session = start && end ? buyWindow(now, start, end, kr, preStart, preEnd) : null;

  const liveMeta = {
    ...meta,
    marketState: quote?.marketState || meta.marketState,
    preMarketPrice: quote?.preMarketPrice ?? meta.preMarketPrice,
    postMarketPrice: quote?.postMarketPrice ?? meta.postMarketPrice,
    regularMarketPrice: quote?.last ?? meta.regularMarketPrice,
  };
  let chartBars = fillMinuteGrid(bars, now);
  if (!chartBars.length) chartBars = use;
  else chartBars = applyLiveQuote(chartBars, liveMeta);
  chartBars = applyTapeHistory(chartBars, meta.symbol);
  const chartLast = chartBars.at(-1);
  if (chartLast && last?.v > 0) chartLast.v = Math.max(chartLast.v || 0, last.v);
  chartBars = allocateSessionVolume(chartBars, quoteVol || volume);
  const packBar = (b) => ({
    time: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    session: barSession(b.t, preStart, start, end, kr),
  });

  return {
    symbol: meta.symbol,
    currency: meta.currency,
    exchange: meta.exchangeName,
    marketState: quote?.marketState || meta.marketState,
    price,
    prev,
    open,
    high,
    low,
    vwap,
    orh,
    orl,
    volume,
    turnover,
    lastVolume: volBar.v,
    lastTurnover,
    quoteVolume: quoteVol,
    avgVol,
    relVol,
    volSpike,
    rsi,
    rsiPrev,
    ema9,
    ema21,
    atr,
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHist: macd.hist,
    macdHistPrev: macdPrev.hist,
    stoch,
    stochPrev,
    change: price - prev,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    gapPct: prev ? ((open - prev) / prev) * 100 : 0,
    fromOpenPct: open ? ((price - open) / open) * 100 : 0,
    barCount: use.length,
    session,
    phase: inPre ? "pre" : "rth",
    kr,
    quote: quote || null,
    exec: executableLong(quote || { last: price, marketState: meta.marketState }, price),
    candles: chartBars.map(packBar),
  };
}

function roundPx(n) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 100) return Math.round(n * 100) / 100;
  if (n >= 10) return Math.round(n * 1000) / 1000;
  if (n >= 1) return Math.round(n * 10000) / 10000;
  return Math.round(n * 1e6) / 1e6;
}

function minRisk(buy) {
  if (!(buy > 0)) return 0.01;
  return Math.max(buy * 0.0025, buy >= 1 ? 0.01 : buy * 0.01);
}

function fmtAmt(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function lookbackRange(candles, n) {
  const slice = (candles || []).slice(-Math.max(n, 2));
  if (slice.length < 2) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of slice) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  return Number.isFinite(hi) && Number.isFinite(lo) && hi > lo ? hi - lo : null;
}

function horizonMove(intraday, fill, minutes) {
  const atr = Number(intraday?.atr) || fill * 0.006;
  const range = lookbackRange(intraday?.candles, minutes);
  const atrPct = fill ? atr / fill : 0.006;
  const fromAtr = atr * Math.sqrt(minutes) * 1.15;
  const fromRange = range != null ? range * (minutes === 5 ? 0.5 : 0.4) : 0;
  const floor = fill * (minutes === 5 ? Math.max(0.008, atrPct * 1.1) : Math.max(0.014, atrPct * 1.7));
  const cap = fill * (minutes === 5 ? 0.04 : 0.06);
  return Math.min(cap, Math.max(floor, fromAtr, fromRange));
}

function clampRisk(fill, raw, t5) {
  const lo = fill * 0.008;
  const hi = Math.min(fill * 0.028, t5 != null ? Math.max(t5 * 1.2, lo) : fill * 0.028);
  return Math.min(hi, Math.max(lo, raw || lo));
}

function computeLiveStop(intraday, buyPrice) {
  const px = buyPrice ?? intraday.exec?.price ?? intraday.price;
  if (px == null) return { price: null, reason: "" };
  const atr = intraday.atr || px * 0.003;
  const t5 = horizonMove(intraday, px, 5);
  const risk = clampRisk(px, Math.max(minRisk(px), atr * 1.4), t5);
  const price = roundPx(px - risk);
  return { price, reason: `실시간 손절 ${price} (약 ${((risk / px) * 100).toFixed(1)}% · 5~10분 단타)` };
}

function tacticLevels(intraday, fill, tactic) {
  const atr = intraday.atr || fill * 0.003;
  const t5 = horizonMove(intraday, fill, 5);
  const t10 = Math.max(t5 * 1.35, horizonMove(intraday, fill, 10));
  const scalp = clampRisk(fill, Math.max(minRisk(fill), atr * 1.4), t5);
  let stop = roundPx(fill - scalp);
  let stopWhy = `5~10분 손절 ${stop} (${((scalp / fill) * 100).toFixed(1)}%)`;
  if (tactic === "orb" && intraday.orh != null) {
    stop = roundPx(Math.min(fill - scalp, Math.max(intraday.orh - atr * 0.12, fill - t5)));
    stopWhy = `ORB/PMH 실패 손절 ${stop}`;
  } else if (tactic === "chase") {
    const floor = intraday.orh != null ? intraday.orh - atr * 0.2 : fill - t5;
    stop = roundPx(Math.min(fill - scalp, Math.max(floor, fill - t5 * 1.15)));
    stopWhy = `과열 추적 실패 손절 ${stop}`;
  } else if ((tactic === "vwap" || tactic === "bounce") && intraday.vwap != null) {
    stop = roundPx(Math.min(Math.max(intraday.vwap - atr * 0.12, fill - t5 * 1.1), fill - scalp));
    stopWhy = tactic === "bounce" ? `반등 실패 손절 ${stop}` : `VWAP 이탈 손절 ${stop}`;
  } else if (tactic === "pullback") {
    const levels = [intraday.ema9, intraday.ema21, intraday.vwap, intraday.orh].filter((n) => n != null);
    const floor = levels.length ? Math.min(...levels) - atr * 0.2 : fill - scalp;
    stop = roundPx(Math.min(Math.max(floor, fill - t5 * 1.15), fill - scalp));
    stopWhy = `눌림목 실패 손절 ${stop}`;
  }
  if (stop == null || stop >= fill) {
    stop = roundPx(fill - scalp);
    stopWhy = `5~10분 손절 ${stop} (${((scalp / fill) * 100).toFixed(1)}%)`;
  }
  const risk = fill - stop;
  if (risk > fill * 0.028) {
    stop = roundPx(fill * 0.972);
    stopWhy = `${stopWhy} · 최대 2.8%`;
  } else if (risk < fill * 0.008) {
    stop = roundPx(fill * 0.992);
    stopWhy = `${stopWhy} · 최소 0.8%`;
  }
  return {
    stopPrice: stop,
    stopWhy,
    sellBase: roundPx(fill + t5),
    stretch: roundPx(fill + t10),
  };
}

function runnerProfile(intraday) {
  const px = Number(intraday?.price);
  const atr = Number(intraday?.atr) || (Number.isFinite(px) ? px * 0.006 : 0);
  const atrPct = px ? (atr / px) * 100 : 0;
  const high = Number(intraday?.high);
  const low = Number(intraday?.low);
  const rangePct = px && Number.isFinite(high) && Number.isFinite(low) ? ((high - low) / px) * 100 : 0;
  const impulse = Math.max(
    Math.abs(Number(intraday?.fromOpenPct) || 0),
    Math.abs(Number(intraday?.gapPct) || 0),
    Math.abs(Number(intraday?.changePct) || 0),
    rangePct,
  );
  const hotTape = (intraday?.volSpike != null && intraday.volSpike >= 1.5)
    || (intraday?.relVol != null && intraday.relVol >= 1.4);
  const megaQuiet = Number.isFinite(px) && px >= 80 && atrPct < 0.45 && impulse < 2.2;
  const mover = atrPct >= 0.4 || rangePct >= 2.2 || impulse >= 2.5 || (hotTape && impulse >= 1);
  return {
    ok: !megaQuiet && mover,
    atrPct,
    rangePct,
    impulse,
    hotTape,
  };
}

function pickDayTactic(intraday, bias) {
  const px = intraday.price;
  const rsi = intraday.rsi;
  const stoch = intraday.stoch;
  const atr = intraday.atr || px * 0.006;
  const vwap = intraday.vwap;
  const ema9 = intraday.ema9;
  const ema21 = intraday.ema21;
  const orh = intraday.orh;
  const mode = intraday.session?.current?.mode || (intraday.session?.current?.buy ? "full" : "none");
  const inWindow = Boolean(intraday.session?.current?.buy);
  const preMode = mode === "pre" || intraday.phase === "pre";
  const candles = intraday.candles || [];
  const last = candles.at(-1);
  const prev = candles.at(-2);
  const runner = runnerProfile(intraday);
  const aboveVwap = vwap != null && px >= vwap;
  const vsVwapPct = vwap ? ((px - vwap) / vwap) * 100 : 0;
  const trend = ema9 != null && ema21 != null && ema9 >= ema21;
  const macdUp = intraday.macdHist != null && intraday.macdHist >= 0;
  const macdAccel = intraday.macdHistPrev == null || (intraday.macdHist != null && intraday.macdHist > intraday.macdHistPrev);
  const rsiBuy = rsi == null || (rsi >= 40 && rsi <= 82);
  const rsiHot = rsi == null || (rsi >= 40 && rsi <= 92);
  const rsiTurn = rsi == null || intraday.rsiPrev == null || rsi > intraday.rsiPrev;
  const stochBuy = stoch == null || (stoch >= 20 && stoch <= 88);
  const stochTurn = stoch == null || intraday.stochPrev == null || stoch > intraday.stochPrev;
  const overheated = (rsi != null && rsi >= 75) || (stoch != null && stoch >= 82)
    || vsVwapPct >= 6 || (preMode ? (intraday.fromOpenPct >= 12 || intraday.gapPct >= 18) : intraday.fromOpenPct >= 8);
  const volAlive = preMode
    ? (intraday.volSpike != null && intraday.volSpike >= 1.4) || runner.hotTape
    : ((intraday.volSpike != null && intraday.volSpike >= 1.2) || (intraday.relVol != null && intraday.relVol >= 1.3));
  const volExpand = Boolean(last && prev && (last.volume || 0) >= (prev.volume || 0) * 0.85);
  const chaseVol = volAlive && volExpand && (
    preMode
      ? (intraday.volSpike != null && intraday.volSpike >= 1.8) || runner.hotTape
      : (intraday.volSpike != null && intraday.volSpike >= 1.6) || (intraday.relVol != null && intraday.relVol >= 1.6)
  );
  const justReclaim = Boolean(prev && last && vwap != null && prev.close < vwap && last.close >= vwap);
  const taggedEma = Boolean(ema9 != null && last && last.low <= ema9 + atr * 0.55 && last.close >= ema9 - atr * 0.08);
  const taggedEma21 = Boolean(ema21 != null && last && last.low <= ema21 + atr * 0.55 && last.close >= ema21 - atr * 0.1);
  const taggedVwap = Boolean(vwap != null && last && last.low <= vwap + atr * 0.5 && last.close >= vwap - atr * 0.12);
  const taggedOrh = Boolean(orh != null && last && last.low <= orh + atr * 0.4 && last.close >= orh);
  const confirmBar = Boolean(last && prev && last.close >= last.open && last.close >= prev.close);
  const recent = candles.slice(-12);
  const swingHigh = recent.length > 3 ? Math.max(...recent.slice(0, -1).map((c) => c.high)) : null;
  const pulled = Boolean(swingHigh && last && last.low <= swingHigh - Math.max(atr * 0.7, swingHigh * 0.004));
  const chase = runner.ok && inWindow && overheated && chaseVol && confirmBar && aboveVwap
    && rsiHot && (rsiTurn || macdAccel) && (rsi == null || rsi < 93);
  const notChase = !overheated || chase;
  const pullback = runner.ok && inWindow && confirmBar && pulled
    && (taggedVwap || taggedEma || taggedEma21 || taggedOrh)
    && (rsi == null || (rsi >= 35 && rsi <= 85))
    && (volAlive || volExpand)
    && (rsiTurn || stochTurn || macdAccel || last.close > prev.close);

  const stacked = runner.ok && inWindow && notChase && confirmBar && volAlive && (chase ? rsiHot : rsiBuy);
  const allowBreak = mode === "pre" || mode === "full";
  const orb = stacked && allowBreak && orh != null && last && last.close >= orh && aboveVwap && (rsi == null || rsi < (chase ? 93 : 84));
  const vwapReclaim = stacked && aboveVwap && justReclaim && (volAlive || macdAccel);
  const bounce = false;
  const continuation = stacked && allowBreak && aboveVwap && volAlive && (trend || macdUp || macdAccel)
    && vsVwapPct >= 0.2
    && (chase ? vsVwapPct <= 15 : vsVwapPct <= 8)
    && (chase
      ? (preMode ? intraday.fromOpenPct < 40 : intraday.fromOpenPct < 25)
      : (preMode ? intraday.fromOpenPct < 18 : intraday.fromOpenPct < 12));

  const newsOk = bias !== "악재 우세";
  const allowNewsBreak = newsOk && allowBreak;

  let tactic = null;
  let label = "";
  if (pullback) {
    tactic = "pullback";
    label = taggedVwap ? "눌림목 · VWAP" : taggedOrh ? "눌림목 · PMH 지지" : "눌림목 · EMA";
  } else if (allowNewsBreak && orb) {
    tactic = "orb";
    label = preMode ? "급등 PMH 돌파" : "급등 ORH 돌파";
  } else if (allowNewsBreak && chase) {
    tactic = "chase";
    label = "상승 과열 추적 · 거래량";
  } else if (vwapReclaim) {
    tactic = "vwap";
    label = "급등 VWAP 회복";
  } else if (allowNewsBreak && continuation) {
    tactic = "trend";
    label = chase ? "상승 과열 지속 · 거래량" : "급등 지속";
  }

  const fire = Boolean(tactic);
  const wait = [];
  if (!inWindow) wait.push(intraday.session?.current?.note || "매수 시간이 아닙니다.");
  else if (!runner.ok) wait.push("대기: 급등 변동·거래량이 붙을 때까지. 대형 저변동은 보지 않습니다.");
  else {
    if (!volAlive) wait.push("대기: 거래량이 평균보다 붙을 때까지");
    if (overheated && !chaseVol) wait.push("대기: 상승 과열 · 거래량이 더 붙으면 추적");
    if (!confirmBar) wait.push("대기: 전봉보다 높은 양봉 확인");
    if (allowBreak && !orb) wait.push(preMode ? "대기: 프장 고점(PMH)을 거래량과 종가로 돌파" : "대기: 시초 고점(ORH)을 거래량과 종가로 돌파");
    if (!pullback) wait.push("대기: 급등 후 VWAP·EMA·PMH까지 눌렸다가 양봉으로 반등");
  }

  return {
    tactic,
    label,
    fire,
    mode,
    inWindow,
    newsOk,
    notChase,
    pullback,
    vwapReclaim,
    bounce,
    chase,
    orb,
    continuation,
    aboveVwap,
    trend,
    rsiBuy,
    stochBuy,
    macdUp,
    volAlive,
    stacked,
    confirmBar,
    runner: runner.ok,
    wait,
  };
}

function buildTradeTicket(action, setup, px, intraday, tactic) {
  const exec = executableLong(intraday.quote, px);
  const fill = exec.price ?? roundPx(px);
  const lv = tacticLevels(intraday, fill, tactic);
  const allowed = action === "당일 롱 관심";
  const tp = computeTakeProfit(intraday, { buyPrice: fill, sellPrice: lv.sellBase, stretch: lv.stretch });
  const liveStop = computeLiveStop(intraday, fill);

  let buyReason = `대기 호가 ${fill}. 지금은 ${action}.`;
  if (action === "당일 롱 관심") {
    buyReason = exec.executable
      ? `${setup} · 지금 ${fill}에 매수. ${exec.reason}`
      : `${setup} · ${exec.reason}`;
  } else if (action === "롱 금지") {
    buyReason = `악재라 신규 매수하지 않습니다. 참고 ${fill}`;
  }

  return {
    allowed,
    locked: true,
    tactic: tactic || null,
    buyPrice: fill,
    buyReason,
    buyLivePrice: exec.price,
    buyLiveReason: exec.reason,
    buyLiveExecutable: exec.executable,
    buyLiveHow: exec.how,
    bid: exec.bid,
    ask: exec.ask,
    spread: exec.spread,
    sellPrice: tp.price,
    sellReason: tp.reason,
    sellAnchor: lv.sellBase,
    sellStretch: lv.stretch,
    takeProfit: tp.price,
    takeProfitReason: tp.reason,
    stopPrice: lv.stopPrice,
    stopReason: lv.stopWhy,
    stopLivePrice: liveStop.price,
    stopLiveReason: liveStop.reason,
  };
}

function computeTakeProfit(intraday, locked) {
  const px = intraday.price;
  const rsi = intraday.rsi;
  const stoch = intraday.stoch;
  const buy = locked.buyPrice;
  const t5 = locked.sellPrice ?? (buy != null ? roundPx(buy + horizonMove(intraday, buy, 5)) : null);
  const t10 = locked.stretch ?? (buy != null ? roundPx(buy + horizonMove(intraday, buy, 10)) : null);
  const elapsed = locked.since ? (Date.now() - Number(locked.since)) / 60000 : 0;
  if (t5 == null || px == null) {
    return { price: null, reason: "익절가를 못 짰습니다." };
  }
  if (elapsed >= 10) {
    return { price: roundPx(px), reason: "10분 만료 — 청산. 그 이상 목표는 없습니다." };
  }
  if (buy != null && t10 != null && px >= t10) {
    return { price: roundPx(px), reason: "10분 목표 도달 — 익절" };
  }
  if (buy != null && px >= t5) {
    return { price: roundPx(px), reason: "5분 목표 도달 — 익절. 더 길게 안 봅니다." };
  }
  if ((rsi != null && rsi >= 75) || (stoch != null && stoch >= 85)) {
    return { price: roundPx(t5), reason: "과열 — 5분 1차만 보고 청산" };
  }
  if (elapsed >= 5 && t10 != null) {
    return { price: roundPx(t10), reason: "5분 미달 · 10분 목표만 남음. 그 이상은 없음" };
  }
  return { price: roundPx(t5), reason: "1차 5분 익절 · 안 되면 10분 · 그 이상은 없음" };
}

function applyLockedTrade(plan, locked, intraday) {
  if (!plan?.trade) return plan;
  const live = plan.trade;
  const buyPrice = locked.buyPrice != null ? locked.buyPrice : live.buyPrice;
  const stopPrice = locked.stopPrice != null ? locked.stopPrice : live.stopPrice;
  const sellAnchor = locked.sellAnchor != null ? locked.sellAnchor : (locked.sellPrice ?? live.sellAnchor ?? live.sellPrice);
  const sellStretch = locked.sellStretch != null ? locked.sellStretch : (live.sellStretch ?? live.stretch);
  const tp = computeTakeProfit(intraday, {
    buyPrice,
    sellPrice: sellAnchor,
    stretch: sellStretch,
    since: locked.since,
  });
  const exec = executableLong(intraday.quote, intraday.price);
  const liveStop = computeLiveStop(intraday, exec.price ?? locked.buyPrice);
  plan.trade = {
    ...live,
    buyPrice,
    buyReason: locked.buyReason || live.buyReason,
    buyLivePrice: exec.price,
    buyLiveReason: exec.reason,
    buyLiveExecutable: exec.executable,
    buyLiveHow: exec.how,
    bid: exec.bid,
    ask: exec.ask,
    spread: exec.spread,
    sellAnchor,
    sellStretch,
    sellPrice: tp.price,
    sellReason: tp.reason,
    takeProfit: tp.price,
    takeProfitReason: tp.reason,
    stopPrice,
    stopReason: locked.stopReason || live.stopReason,
    stopLivePrice: liveStop.price,
    stopLiveReason: liveStop.reason,
    locked: true,
    buySignal: live.allowed || plan.action === "당일 롱 관심",
  };
  return plan;
}

function dayTradePlan(intraday, bias) {
  if (!intraday) {
    return {
      action: "관망",
      setup: "분봉 없음",
      reasons: ["1분봉을 못 받아서 진입가를 못 짭니다."],
      rules: ["시세 연결 후 다시 검색"],
    };
  }

  const px = intraday.price;
  const rsi = intraday.rsi;
  const picked = pickDayTactic(intraday, bias);
  const preMode = picked.mode === "pre";
  const checks = [
    { name: "급등 셋업", ok: picked.runner },
    { name: "거래량 급증", ok: picked.volAlive },
    { name: "양봉 확인", ok: picked.confirmBar },
    { name: "VWAP 위", ok: picked.aboveVwap },
    { name: "눌림목", ok: picked.pullback },
    { name: preMode ? "PMH 돌파" : "ORH 돌파", ok: picked.orb },
    { name: "과열 추적", ok: Boolean(picked.chase) || picked.notChase },
    { name: "매수 시간", ok: picked.inWindow },
    { name: "뉴스 통과", ok: picked.newsOk },
  ];

  const reasons = [];
  const rules = [
    "급등주 단타. 대형·저변동은 보지 않습니다.",
    "거래량 붙은 PMH 돌파·VWAP 회복·눌림목. 5분 1차, 안 되면 10분 2차.",
    "상승 과열은 거래량이 붙으면 추적. 거래량 빠지면 추격 금지.",
  ];

  let action = "관망";
  let setup = picked.inWindow ? "셋업 대기" : (intraday.session?.current?.name || "시간대 외");

  if (!picked.inWindow) {
    reasons.push(intraday.session?.current?.note || "매수 시간이 아닙니다.");
  } else if (!picked.runner) {
    setup = "급등 셋업 아님";
    reasons.push("대형주·저변동은 이 레이더 타점이 아닙니다. 거래량 붙은 급등주만 봅니다.");
  } else if (picked.fire) {
    action = "당일 롱 관심";
    setup = bias === "악재 우세" ? `축소 · ${picked.label}` : picked.label;
    reasons.push(`${picked.label}. RSI ${rsi?.toFixed?.(1) ?? "-"} · 거래량 ${picked.volAlive ? "급증" : "약함"}. 5분 1차, 10분 2차.`);
    if (picked.chase) reasons.push("거래량이 붙어 상승 과열을 5~10분 추적합니다. 거래량 빠지면 바로 중단.");
    if (picked.pullback) reasons.push("급등 후 눌림목 반등입니다. 지지 깨지면 손절.");
    if (preMode) reasons.push("프장 주력 구간입니다. 스프레드를 보고 지정가로 넣습니다.");
    if (bias === "악재 우세") reasons.push("당일 악재가 있어 사이즈만 줄입니다. 돌파 추격은 하지 않습니다.");
    if (picked.mode === "pullback" && picked.tactic !== "pullback") reasons.push("정규 보조 구간이라 돌파 추격 없이 눌림·VWAP만 탑니다.");
  } else if (!picked.notChase) {
    action = "추격 금지 / 거래량 대기";
    setup = "과열 · 거래량 없음";
    reasons.push(`상승 과열(RSI ${rsi?.toFixed?.(1) ?? "-"}, 시가대비 ${intraday.fromOpenPct.toFixed(2)}%)이지만 거래량이 안 붙었습니다. 눌림목이나 거래량 급증을 기다립니다.`);
  } else {
    setup = !picked.volAlive ? "거래량 대기" : (px < (intraday.vwap ?? px) ? "VWAP 회복 대기" : "급등 타점 대기");
    reasons.push(...picked.wait.slice(0, 3));
  }

  const trade = buildTradeTicket(action, setup, px, intraday, picked.tactic);
  const indicators = {
    rsi: rsi != null ? Number(rsi.toFixed(1)) : null,
    ema9: roundPx(intraday.ema9),
    ema21: roundPx(intraday.ema21),
    vwap: roundPx(intraday.vwap),
    vsVwapPct: intraday.vwap ? Number((((px - intraday.vwap) / intraday.vwap) * 100).toFixed(2)) : null,
    atr: roundPx(intraday.atr),
    macd: intraday.macd != null ? Number(intraday.macd.toFixed(4)) : null,
    macdHist: intraday.macdHist != null ? Number(intraday.macdHist.toFixed(4)) : null,
    stoch: intraday.stoch != null ? Number(intraday.stoch.toFixed(1)) : null,
    volume: intraday.volume,
    lastVolume: intraday.lastVolume,
    volSpike: intraday.volSpike != null ? Number(intraday.volSpike.toFixed(2)) : null,
    relVol: intraday.relVol != null ? Number(intraday.relVol.toFixed(2)) : null,
    turnover: intraday.turnover,
    lastTurnover: intraday.lastTurnover,
    turnoverLabel: fmtAmt(intraday.turnover),
    lastTurnoverLabel: fmtAmt(intraday.lastTurnover),
  };

  return {
    action,
    setup,
    reasons,
    rules,
    checks,
    session: intraday.session,
    indicators,
    trade,
    buySignal: action === "당일 롱 관심",
    tactic: picked.tactic,
    levels: {
      price: roundPx(px),
      open: roundPx(intraday.open),
      vwap: roundPx(intraday.vwap),
      orh: roundPx(intraday.orh),
      orl: roundPx(intraday.orl),
      high: roundPx(intraday.high),
      low: roundPx(intraday.low),
      stop: trade.stopPrice,
      target1: trade.sellPrice,
      target2: trade.takeProfit,
    },
    stats: {
      gapPct: Number(intraday.gapPct.toFixed(2)),
      fromOpenPct: Number(intraday.fromOpenPct.toFixed(2)),
      changePct: Number(intraday.changePct.toFixed(2)),
      relVol: indicators.relVol,
      rsi: indicators.rsi,
      marketState: intraday.marketState,
    },
  };
}

function candlePayload(chart) {
  return barsFromChart(chart).map((b) => ({
    time: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

function barsToChart(symbol, bars, quote) {
  if (!bars?.length) return null;
  const state = tapeSessionNow();
  const last = bars.at(-1);
  const live = quote?.last || last?.c;
  return {
    meta: {
      symbol,
      currency: "USD",
      exchangeName: "US",
      marketState: state === "PRE" ? "PRE" : state === "POST" ? "POST" : state === "REGULAR" ? "REGULAR" : "CLOSED",
      regularMarketPrice: live,
      preMarketPrice: state === "PRE" ? live : undefined,
      postMarketPrice: state === "POST" || state === "CLOSED" ? live : undefined,
      chartPreviousClose: quote?.prevClose || undefined,
      regularMarketTime: last?.t,
      regularMarketVolume: quote?.volume,
    },
    timestamp: bars.map((b) => b.t),
    indicators: {
      quote: [{
        open: bars.map((b) => b.o),
        high: bars.map((b) => b.h),
        low: bars.map((b) => b.l),
        close: bars.map((b) => b.c),
        volume: bars.map((b) => b.v),
      }],
    },
  };
}

const dailyChartCache = new Map();
async function yahooDailyCached(symbol) {
  const hit = dailyChartCache.get(symbol);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.chart;
  const chart = await yahooChart(symbol, "1d", "5d").catch(() => null);
  if (chart) {
    dailyChartCache.set(symbol, { at: Date.now(), chart });
    if (dailyChartCache.size > 40) dailyChartCache.delete(dailyChartCache.keys().next().value);
  }
  return chart;
}

async function livePack(symbol, bias, locked) {
  const kiwoom = await kiwoomSession(symbol).catch((err) => {
    console.warn("kiwoom:", err.message);
    return { bars: [], quote: null };
  });
  const haveKwBars = Boolean(kiwoom?.bars?.length);
  const [c1m, c1d, quote] = await Promise.all([
    haveKwBars ? Promise.resolve(null) : yahooChart(symbol, "1m", "2d").catch(() => null),
    yahooDailyCached(symbol),
    kiwoom?.quote?.shares && kiwoom?.quote?.marketCap
      ? Promise.resolve(null)
      : yahooQuote(symbol).catch(() => null),
  ]);
  const chart1m = c1m || barsToChart(symbol, kiwoom?.bars || [], kiwoom?.quote);
  if (!chart1m) throw new Error("1분봉을 못 가져왔습니다.");
  const chartQ = packQuote(chart1m.meta);
  const kw = kiwoom?.quote || {};
  const session = tapeSessionNow();
  const liveLast = kw.last ?? quote?.last ?? chartQ?.last;
  const merged = {
    last: liveLast,
    bid: kw.bid || quote?.bid,
    ask: kw.ask || quote?.ask,
    bidSize: quote?.bidSize,
    askSize: quote?.askSize,
    volume: kw.volume || quote?.volume,
    shares: kw.shares || quote?.shares || null,
    marketCap: kw.marketCap || quote?.marketCap || null,
    marketState: session === "PRE" ? "PRE" : session === "POST" ? "POST" : session === "REGULAR" ? "REGULAR" : (quote?.marketState || chart1m.meta?.marketState || chartQ?.marketState || "CLOSED"),
    preMarketPrice: session === "PRE" ? liveLast : (quote?.preMarketPrice ?? rawNum(chart1m.meta?.preMarketPrice)),
    postMarketPrice: session === "POST" || session === "CLOSED" ? liveLast : (quote?.postMarketPrice ?? rawNum(chart1m.meta?.postMarketPrice)),
  };
  if (kw.prevClose > 0) rememberRthClose(symbol, kw.prevClose);
  const intraday = buildIntraday(chart1m, c1d, merged, haveKwBars ? [] : (kiwoom?.bars || []));
  let plan = dayTradePlan(intraday, bias);
  if (locked?.buyPrice != null || locked?.sellPrice != null) {
    plan = applyLockedTrade(plan, locked, intraday);
  }
  return {
    symbol: intraday?.symbol || symbol,
    price: intraday?.price,
    marketState: merged?.marketState || intraday?.marketState,
    candles: intraday?.candles || candlePayload(chart1m),
    quote: intraday
      ? {
        symbol: intraday.symbol,
        currency: intraday.currency,
        exchange: intraday.exchange,
        price: intraday.price,
        last: merged?.last ?? intraday.price,
        bid: merged?.bid,
        ask: merged?.ask,
        bidSize: merged?.bidSize,
        askSize: merged?.askSize,
        change: intraday.change,
        changePct: intraday.changePct,
        shares: merged?.shares ?? null,
        marketCap: merged?.marketCap ?? null,
        marketState: merged?.marketState || intraday.marketState,
      }
      : null,
    plan,
    tape: kw.volume || (kiwoom?.bars || []).some((b) => b.v > 0) ? "kiwoom" : "yahoo",
  };
}

function isUsListed(q) {
  const symbol = String(q.symbol || "");
  if (!symbol || /\.(KS|KQ|T|L|HK|TO|AX|NS|BO)$/i.test(symbol)) return false;
  if (q.quoteType && q.quoteType !== "EQUITY") return false;
  const ex = `${q.fullExchangeName || ""} ${q.exchange || ""} ${q.exchDisp || ""}`.toUpperCase();
  if (/OTC|PINK|PNK|GREY|EXPERT|OTHER OTC/.test(ex)) return false;
  if (/NMS|NGM|NCM|NASDAQ|NYQ|NYSE|ASE|AMEX|ARCA|PCX|BATS|CBOE/.test(ex)) return true;
  return !symbol.includes(".");
}

function mapMover(q) {
  const price = rawNum(q.regularMarketPrice);
  const change = rawNum(q.regularMarketChange);
  const changePct = rawNum(q.regularMarketChangePercent);
  const volume = rawNum(q.regularMarketVolume);
  const avgVol = rawNum(q.averageDailyVolume3Month) || rawNum(q.averageDailyVolume10Day);
  const stats = sessionVolumeStats(volume, avgVol);
  const relVol = stats.relVol;
  const heat = changePct != null
    ? Number((changePct * Math.min(Math.max(relVol || 1, 0.5), 8)).toFixed(1))
    : changePct;
  return {
    symbol: q.symbol,
    name: q.shortName || q.longName || q.displayName || q.symbol,
    exchange: q.fullExchangeName || q.exchDisp || q.exchange || "",
    price,
    change,
    changePct: changePct != null ? Number(changePct.toFixed(2)) : null,
    volume,
    avgVol,
    relVol,
    volSurgePct: stats.volSurgePct,
    volDelta: stats.volDelta,
    marketCap: rawNum(q.marketCap),
    heat,
  };
}

async function yahooScreener(scrId, count = 100) {
  const qs = new URLSearchParams({
    formatted: "false",
    lang: "en-US",
    region: "US",
    scrIds: scrId,
    count: String(count),
  });
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?${qs}`;
  let data;
  try {
    data = await yahooJson(url);
  } catch {
    data = await fetchJson(url);
  }
  return data.finance?.result?.[0]?.quotes || [];
}

function parseListedMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[$,%\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isCommonUsStock(row) {
  const symbol = String(row.symbol || "").trim().toUpperCase();
  if (!symbol || /[\^/]/.test(symbol) || symbol.includes(".")) return false;
  const name = String(row.name || "");
  if (/\b(warrant|warrants|right|rights|unit|units|preferred|note|notes|debenture|etf|etn)\b/i.test(name)) {
    return false;
  }
  return true;
}

function mapNasdaqRow(row) {
  const price = parseListedMoney(row.lastsale);
  const change = parseListedMoney(row.netchange);
  const changePct = parseListedMoney(row.pctchange);
  const volume = parseListedMoney(row.volume);
  const marketCap = parseListedMoney(row.marketCap);
  return {
    symbol: String(row.symbol || "").toUpperCase(),
    name: row.name || row.symbol,
    exchange: "US",
    price,
    change,
    changePct: changePct != null ? Number(changePct.toFixed(2)) : null,
    volume,
    avgVol: null,
    relVol: null,
    marketCap,
    heat: changePct != null ? Number(changePct.toFixed(1)) : null,
  };
}

async function nasdaqAllStocks() {
  const url = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&download=true";
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
    },
  });
  if (!res.ok) throw new Error(`Nasdaq 전종목 실패 ${res.status}`);
  const data = await res.json();
  const rows = data.data?.rows || data.data?.table?.rows || [];
  return rows.filter(isCommonUsStock).map(mapNasdaqRow);
}

let listedCache = { at: 0, rows: [] };
let minuteCache = { at: 0, rows: [] };

async function listedUniverse() {
  if (Date.now() - listedCache.at < 5 * 60 * 1000 && listedCache.rows.length) {
    return listedCache.rows;
  }
  const rows = await nasdaqAllStocks();
  listedCache = { at: Date.now(), rows };
  return rows;
}

async function yahooMinuteChart(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      "?interval=1m&range=1d&includePrePost=true&region=US&lang=en-US";
  const data = await fetchJson(url);
  return data.chart?.result?.[0] || null;
}

function minuteHeat(pct, relVol) {
  if (!Number.isFinite(Number(pct))) return null;
  const rel = Number(relVol);
  const mul = Number.isFinite(rel) && rel > 0 ? Math.min(Math.max(rel, 0.3), 8) : 1;
  return Number((Number(pct) * mul).toFixed(1));
}

function lastMinuteStats(chart) {
  const all = barsFromChart(chart).filter((b) => b.c != null);
  if (all.length < 2) return null;
  const now = Math.floor(Date.now() / 1000);
  const last = all.at(-1);
  if (now - last.t > 15 * 60) return null;
  const prev = all.at(-2);
  const withVol = all.filter((b) => b.v > 0);
  const print = withVol.at(-1) || last;
  const hist = withVol.filter((b) => b.t < print.t).slice(-16);
  const avgVol = hist.length ? hist.reduce((s, b) => s + b.v, 0) / hist.length : (print.v || null);
  const changePct = prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0;
  const hasPrint = print.v > 0;
  const relVol = hasPrint && avgVol ? print.v / avgVol : null;
  const volDelta = hasPrint && avgVol != null ? print.v - avgVol : null;
  const volSurgePct = hasPrint && avgVol ? ((print.v - avgVol) / avgVol) * 100 : null;
  const turnover = last.c * (last.v || print.v || 0);
  return {
    price: last.c,
    change: last.c - prev.c,
    changePct: Number(changePct.toFixed(2)),
    volume: last.v,
    turnover,
    avgVol: avgVol ? Math.round(avgVol) : null,
    volDelta: Number.isFinite(volDelta) ? Math.round(volDelta) : null,
    volSurgePct: volSurgePct != null ? Number(volSurgePct.toFixed(1)) : null,
    relVol: relVol != null ? Number(relVol.toFixed(2)) : null,
    heat: minuteHeat(changePct, relVol),
    minute: true,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function isGainerName(row) {
  const px = Number(row?.price);
  const cap = Number(row?.marketCap);
  if (Number.isFinite(px) && (px < 0.001 || px >= 80)) return false;
  if (Number.isFinite(cap) && cap >= 20e9) return false;
  return true;
}

function pickWatch(listed, q) {
  const watch = [];
  const seen = new Set();
  const add = (row) => {
    if (!row?.symbol || seen.has(row.symbol)) return;
    seen.add(row.symbol);
    watch.push(row);
  };
  if (q) {
    const needle = q.toLowerCase();
    for (const row of listed) {
      if (`${row.symbol} ${row.name}`.toLowerCase().includes(needle)) add(row);
      if (watch.length >= 80) break;
    }
  }
  const pool = listed.filter(isGainerName);
  const byVol = [...(pool.length ? pool : listed)].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  for (const row of byVol) {
    add(row);
    if (watch.length >= (q ? 80 : 200)) break;
  }
  return watch;
}

async function attachMinute(rows) {
  const mapped = await mapLimit(rows, 16, async (row) => {
    try {
      const chart = await yahooMinuteChart(row.symbol);
      const minute = lastMinuteStats(chart);
      if (!minute) {
        return {
          ...row,
          dayChangePct: row.dayChangePct ?? row.changePct ?? null,
          minuteChangePct: row.minuteChangePct ?? null,
          heat: minuteHeat(row.minuteChangePct, row.minuteRelVol),
        };
      }
      return {
        ...row,
        ...minute,
        name: row.name,
        dayChangePct: row.dayChangePct ?? row.changePct ?? null,
        minuteChangePct: minute.changePct,
        minuteRelVol: minute.relVol ?? null,
        heat: minuteHeat(minute.changePct, minute.relVol),
        changePct: row.changePct ?? minute.changePct,
        volume: row.volume || minute.volume,
        turnover: row.turnover || (row.price && row.volume ? row.price * row.volume : minute.turnover),
        volSurgePct: row.volSurgePct ?? minute.volSurgePct ?? sessionVolumeStats(row.volume || minute.volume, row.avgVol).volSurgePct,
        volDelta: row.volDelta ?? minute.volDelta ?? sessionVolumeStats(row.volume || minute.volume, row.avgVol).volDelta,
        avgVol: row.avgVol ?? minute.avgVol,
      };
    } catch {
      return null;
    }
  });
  return mapped.filter(Boolean);
}

async function attachMinuteChange(rows) {
  const session = tapeSessionNow();
  const mapped = await mapLimit(rows, 12, async (row) => {
    try {
      const chart = await yahooMinuteChart(row.symbol);
      const rthClose = rthCloseFromChart(chart);
      if (rthClose) rememberRthClose(row.symbol, rthClose);
      const minute = lastMinuteStats(chart);
      const price = minute?.price || row.price;
      const afterPct = (session === "PRE" || session === "POST" || (session === "CLOSED" && rthClose))
        ? (pctFromClose(price, rthClose) ?? 0)
        : null;
      if (!minute) {
        return {
          ...row,
          minuteChangePct: row.minuteChangePct ?? null,
          heat: minuteHeat(row.minuteChangePct, row.minuteRelVol),
          ...(afterPct != null ? { dayChangePct: afterPct, changePct: afterPct } : {}),
        };
      }
      return {
        ...row,
        minuteChangePct: minute.changePct,
        minuteRelVol: minute.relVol ?? null,
        heat: minuteHeat(minute.changePct, minute.relVol),
        price: row.price || minute.price,
        ...(afterPct != null ? { dayChangePct: afterPct, changePct: afterPct } : {}),
      };
    } catch {
      return {
        ...row,
        minuteChangePct: row.minuteChangePct ?? null,
        heat: minuteHeat(row.minuteChangePct, row.minuteRelVol),
      };
    }
  });
  return mapped.filter(Boolean);
}

async function usGainers(params) {
  resetUsBoardIfNewEtDay();
  const session = tapeSessionNow();
  const listed = await listedUniverse().catch(() => []);
  const q = String(params?.get?.("q") || "").trim();
  const kw = await kiwoomVolumeBoard().catch((err) => {
    console.warn("kiwoom board:", err.message);
    return { at: 0, rows: [], basis: "" };
  });
  const byKiwoom = session === "CLOSED";
  if (kw.rows.length) {
    let rows = kw.rows;
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => `${r.symbol} ${r.name}`.toLowerCase().includes(needle));
    }
    if (rows.length) {
      rows = rows.slice(0, 80);
      rows = await liveBoardRows(rows);
      if (byKiwoom) {
        rows.sort((a, b) => (a.kiwoomRank ?? 9999) - (b.kiwoomRank ?? 9999));
      } else {
        rows.sort(compareLiveRank);
      }
      minuteCache = { at: Date.now(), rows };
      return rows;
    }
  }
  if (!q && Date.now() - minuteCache.at < 20000 && minuteCache.rows.length) {
    return liveBoardRows(minuteCache.rows);
  }
  const universe = listed.length ? listed : kw.rows;
  const watch = pickWatch(universe, q);
  const attached = await attachMinute(watch);
  const rows = attached.map((row) => ({
    ...row,
    dayChangePct: row.dayChangePct ?? row.changePct ?? null,
    minuteChangePct: row.minuteChangePct ?? (row.minute ? row.changePct : null),
    heat: minuteHeat(
      row.minuteChangePct ?? (row.minute ? row.changePct : null),
      row.minuteRelVol ?? (row.minute ? row.relVol : null),
    ),
  }));
  rows.sort(compareLiveRank);
  minuteCache = { at: Date.now(), rows };
  return liveBoardRows(rows);
}

function filterGainers(rows, params) {
  const q = String(params.get("q") || "").trim().toLowerCase();
  const minPct = Number(params.get("minPct") ?? 0.5);
  const minVol = Number(params.get("minVol") ?? 0);
  const minPrice = Number(params.get("minPrice") ?? 0);
  const maxPrice = Number(params.get("maxPrice") ?? 0);
  const minRel = Number(params.get("minRel") ?? 0);
  const minTurnover = Number(params.get("minTurnover") ?? 0);
  const limit = Math.min(Number(params.get("limit") ?? 200) || 200, 400);
  const sort = params.get("sort") || "min1";
  const filtered = rows.filter((r) => {
    if (q) {
      const hay = `${r.symbol} ${r.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    } else if (minPct > 0) {
      const dayPct = r.dayChangePct ?? r.changePct;
      if (dayPct == null || dayPct < minPct) return false;
    }
    if (minVol > 0 && (r.volume == null || r.volume < minVol)) return false;
    if (minTurnover > 0 && (r.turnover == null || r.turnover < minTurnover)) return false;
    if (minPrice > 0 && r.price != null && r.price < minPrice) return false;
    if (maxPrice > 0 && r.price != null && r.price >= maxPrice) return false;
    if (minRel > 0 && (r.relVol == null || r.relVol < minRel)) return false;
    return true;
  });
  const key = sort === "heat" ? "heat"
    : sort === "volume" ? "volume"
    : sort === "rel" ? "relVol"
    : sort === "surge" ? "volSurgePct"
    : sort === "delta" ? "volDelta"
    : sort === "turnover" ? "turnover"
    : sort === "min1" ? "minuteChangePct"
    : "dayChangePct";
  if (tapeSessionNow() === "CLOSED" && (sort === "min1" || sort === "kiwoom")) {
    filtered.sort((a, b) => (a.kiwoomRank ?? 9999) - (b.kiwoomRank ?? 9999));
  } else if (sort === "min1") {
    filtered.sort(compareLiveRank);
  } else {
    filtered.sort((a, b) => (b[key] ?? -999) - (a[key] ?? -999) || (b.volDelta ?? -1) - (a.volDelta ?? -1));
  }
  return filtered.slice(0, limit);
}

async function scan(query) {
  const q = query.trim();
  if (!q) throw new Error("티커 또는 회사명을 입력하세요.");

  const [yahoo, naver] = await Promise.all([
    yahooSearch(q).catch(() => ({ quotes: [], news: [] })),
    hasHangul(q) ? naverSearch(q).catch(() => []) : Promise.resolve([]),
  ]);

  const quotes = [];
  const seen = new Set();
  for (const item of [...yahoo.quotes, ...naver]) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    quotes.push(item);
  }
  const best = pickBestQuote(quotes);
  const ticker = (best?.symbol || q).replace(/\.(KS|KQ)$/i, "");
  const feeds = await Promise.allSettled([
    googleOverseasNews(ticker),
    stockTitanNews(ticker),
    wireNews(ticker),
    analystNews(ticker),
    best ? yahooHeadlineRss(best.symbol) : Promise.resolve([]),
    reutersRss(ticker),
    cnbcRss(ticker),
    Promise.resolve(yahoo.news),
  ]);

  const items = dedupe(feeds.flatMap((f) => (f.status === "fulfilled" ? f.value : [])))
    .filter(isOverseas)
    .filter((item) => isEquityNews(item, ticker, best?.name || q))
    .map((item) => {
      const tagged = classify(item.title);
      const age = item.publishedAt ? Date.now() - Date.parse(item.publishedAt) : null;
      return {
        ...item,
        ...tagged,
        channel: newsChannel(item),
        fresh: age != null && age <= DAY_MS,
      };
    })
    .filter((item) => withinWeek(item.publishedAt))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const bias = newsBias(items);
  const live = best ? await livePack(best.symbol, bias).catch(() => null) : null;

  return {
    query: q,
    asOf: new Date().toISOString(),
    windowDays: 7,
    style: "same-day-long",
    company: best,
    candidates: quotes.slice(0, 6),
    quote: live?.quote || null,
    condition: bias,
    candles: live?.candles || [],
    plan: live?.plan || dayTradePlan(null, bias),
    counts: {
      total: items.length,
      positive: items.filter((i) => i.label === "호재").length,
      negative: items.filter((i) => i.label === "악재").length,
      fresh: items.filter((i) => i.fresh).length,
    },
    items: items.slice(0, 40),
    disclaimer: "당일 단타 시나리오 초안이며 투자 권유가 아닙니다. 해외 공개 뉴스·지연 시세 기준입니다.",
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/gainers") {
      const rows = await usGainers(url.searchParams);
      const items = filterGainers(rows, url.searchParams);
      const session = tapeSessionNow();
      return json(res, 200, {
        asOf: new Date().toISOString(),
        market: "US",
        session,
        etDay: etDateKey(),
        basis: session === "CLOSED" ? "kiwoom" : "1m",
        universe: listedCache.rows.length || rows.length,
        scanned: rows.length,
        count: items.length,
        source: rows[0]?.source ? "kiwoom" : "yahoo",
        items,
        disclaimer: "키움 거래량급증·당일 거래량 상위 기준입니다. 지연 시세이며 투자 권유가 아닙니다.",
      });
    }
    if (url.pathname === "/api/scan") {
      return json(res, 200, await scan(url.searchParams.get("q") || ""));
    }
    if (url.pathname === "/api/chart") {
      const symbol = url.searchParams.get("symbol") || "";
      const bias = url.searchParams.get("bias") || "중립";
      if (!symbol) throw new Error("symbol 필요");
      lastChartSymbol = String(symbol).toUpperCase().split(".")[0];
      const locked = {
        buyPrice: Number(url.searchParams.get("buy")) || null,
        sellPrice: Number(url.searchParams.get("sell")) || null,
        sellStretch: Number(url.searchParams.get("sell10")) || null,
        stopPrice: Number(url.searchParams.get("stop")) || null,
        since: Number(url.searchParams.get("since")) || null,
        buyReason: url.searchParams.get("buyReason") || "",
        sellReason: url.searchParams.get("sellReason") || "",
        stopReason: url.searchParams.get("stopReason") || "",
      };
      return json(res, 200, await livePack(symbol, bias, locked));
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("ok");
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    let filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
      res.writeHead(403);
      return res.end();
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    json(res, 500, { error: err.message || "서버 오류" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`stock-radar  http://0.0.0.0:${PORT}`);
});
