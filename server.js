import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8787);
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
  return {
    last: rawNum(p.regularMarketPrice ?? p.last),
    bid: rawNum(p.bid),
    ask: rawNum(p.ask),
    bidSize: rawNum(p.bidSize),
    askSize: rawNum(p.askSize),
    marketState: p.marketState || "",
  };
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
  const livePx = meta.regularMarketPrice;
  if (!last || livePx == null) return use;
  const liveTs = meta.regularMarketTime || last.t;
  if (Math.floor(last.t / 60) === Math.floor(liveTs / 60)) {
    last.c = livePx;
    last.h = Math.max(last.h, livePx);
    last.l = Math.min(last.l, livePx);
    return use;
  }
  if (liveTs > last.t) {
    use.push({
      t: liveTs,
      o: last.c,
      h: Math.max(last.c, livePx),
      l: Math.min(last.c, livePx),
      c: livePx,
      v: last.v,
    });
  } else {
    last.c = livePx;
    last.h = Math.max(last.h, livePx);
    last.l = Math.min(last.l, livePx);
  }
  return use;
}

function buildIntraday(chart1m, chart1d, quote) {
  if (!chart1m) return null;
  const meta = chart1m.meta || {};
  const bars = barsFromChart(chart1m);
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
  use = applyLiveQuote(use, meta);

  const open = use[0].o;
  const last = use.at(-1);
  const price = meta.regularMarketPrice ?? last.c;
  const high = Math.max(...use.map((b) => b.h));
  const low = Math.min(...use.map((b) => b.l));
  const volume = use.reduce((s, b) => s + b.v, 0);
  const turnover = use.reduce((s, b) => s + b.c * b.v, 0);
  const lastTurnover = last.c * last.v;
  const orBars = use.filter((b) => b.t < (sessionOpen || use[0].t) + orWindow);
  const orPool = orBars.length ? orBars : use.slice(0, 15);
  const orh = Math.max(...orPool.map((b) => b.h));
  const orl = Math.min(...orPool.map((b) => b.l));
  const pv = use.reduce((s, b) => s + ((b.h + b.l + b.c) / 3) * b.v, 0);
  const vwap = volume ? pv / volume : price;
  const closes = use.map((b) => b.c);
  const ema9 = emaSeries(closes, 9).at(-1);
  const ema21 = emaSeries(closes, 21).at(-1);
  const rsi = rsiValue(closes, 14);
  const atr = atrValue(use, 14);
  const macd = macdValue(closes);
  const stoch = stochK(use, 14);
  const lookback = use.slice(-21, -1);
  const avg1mVol = lookback.length
    ? lookback.reduce((s, b) => s + b.v, 0) / lookback.length
    : last.v;
  const volSpike = avg1mVol ? last.v / avg1mVol : 1;

  const daily = chart1d ? barsFromChart(chart1d) : [];
  const prev = meta.chartPreviousClose ?? daily.at(-2)?.c ?? open;
  const avgVol = daily.length
    ? daily.slice(0, -1).reduce((s, b) => s + b.v, 0) / Math.max(daily.length - 1, 1)
    : null;
  const elapsedMin = Math.max((last.t - (sessionOpen || use[0].t)) / 60, 1);
  const sessionMin = inPre ? 330 : 390;
  const expectedVol = avgVol ? avgVol * (elapsedMin / sessionMin) : null;
  const relVol = expectedVol ? volume / expectedVol : (avgVol ? volume / avgVol : null);

  const kr = /\.(KS|KQ)$/i.test(meta.symbol || "");
  const session = start && end ? buyWindow(now, start, end, kr, preStart, preEnd) : null;

  return {
    symbol: meta.symbol,
    currency: meta.currency,
    exchange: meta.exchangeName,
    marketState: meta.marketState,
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
    lastVolume: last.v,
    lastTurnover,
    avgVol,
    relVol,
    volSpike,
    rsi,
    ema9,
    ema21,
    atr,
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHist: macd.hist,
    stoch,
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
    candles: use.map((b) => ({
      time: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    })),
  };
}

function roundPx(n) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 100) return Math.round(n * 100) / 100;
  if (n >= 10) return Math.round(n * 1000) / 1000;
  return Math.round(n * 10000) / 10000;
}

function minRisk(buy) {
  return Math.max(buy * 0.0025, 0.01);
}

function fmtAmt(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function computeLiveStop(intraday, buyPrice) {
  const px = buyPrice ?? intraday.exec?.price ?? intraday.price;
  if (px == null) return { price: null, reason: "" };
  const atr = intraday.atr || px * 0.003;
  const risk = Math.max(minRisk(px), atr * 0.7);
  const price = roundPx(px - risk);
  return { price, reason: `실시간 손절 ${price} (체결가 − 0.7 ATR)` };
}

function tacticLevels(intraday, fill, tactic) {
  const atr = intraday.atr || fill * 0.003;
  const scalp = Math.max(minRisk(fill), atr * 0.7);
  let stop = roundPx(fill - scalp);
  let stopWhy = `단타 손절 ${stop} (0.7 ATR)`;
  if (tactic === "orb" && intraday.orh != null) {
    stop = roundPx(Math.min(fill - scalp, intraday.orh - atr * 0.12));
    stopWhy = `ORB/PMH 실패 손절 ${stop}`;
  } else if (tactic === "vwap" && intraday.vwap != null) {
    stop = roundPx(Math.min(intraday.vwap - atr * 0.12, fill - scalp));
    stopWhy = `VWAP 이탈 손절 ${stop}`;
  } else if (tactic === "pullback") {
    const floor = intraday.ema21 != null ? intraday.ema21 : fill - scalp;
    stop = roundPx(Math.min(floor, fill - scalp));
    stopWhy = `EMA 눌림 실패 손절 ${stop}`;
  }
  if (stop == null || stop >= fill) {
    stop = roundPx(fill - scalp);
    stopWhy = `단타 손절 ${stop} (0.7 ATR)`;
  }
  const target = roundPx(fill + (fill - stop));
  return { stopPrice: stop, stopWhy, sellBase: target };
}

function pickDayTactic(intraday, bias) {
  const px = intraday.price;
  const rsi = intraday.rsi;
  const atr = intraday.atr || px * 0.003;
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
  const aboveVwap = vwap != null && px >= vwap;
  const trend = ema9 != null && ema21 != null && ema9 >= ema21;
  const macdUp = intraday.macdHist == null || intraday.macdHist >= 0;
  const notChase = preMode
    ? !((rsi != null && rsi >= 82) || (intraday.gapPct >= 15 && rsi != null && rsi >= 70) || (intraday.fromOpenPct >= 10 && rsi != null && rsi >= 72))
    : !((rsi != null && rsi >= 78) || (intraday.fromOpenPct >= 6 && rsi != null && rsi >= 70));
  const volAlive = preMode
    ? (intraday.volSpike == null || intraday.volSpike >= 1)
    : (intraday.relVol == null || intraday.relVol >= 0.7) && (intraday.volSpike == null || intraday.volSpike >= 0.75);
  const justReclaim = Boolean(prev && last && vwap != null && prev.close < vwap && last.close >= vwap);
  const nearVwap = vwap != null && Math.abs(px - vwap) <= atr * 1.4;
  const taggedEma = Boolean(ema9 != null && last && last.low <= ema9 + atr * 0.3 && px >= Math.min(ema9, last.close));
  const rsiBuy = rsi == null || (rsi >= 38 && rsi <= 72);

  const allowBreak = mode === "pre" || mode === "full";
  const pullback = inWindow && aboveVwap && trend && taggedEma && rsiBuy && notChase;
  const vwapReclaim = inWindow && aboveVwap && (justReclaim || nearVwap) && rsiBuy && notChase && (trend || macdUp);
  const orb = inWindow && allowBreak && orh != null && px >= orh && aboveVwap && volAlive && (rsi == null || rsi < 75) && notChase;
  const continuation = inWindow && allowBreak && aboveVwap && trend && macdUp && rsiBuy && volAlive && notChase;

  const newsOk = bias !== "악재 우세";
  const allowNewsBreak = newsOk && allowBreak;

  let tactic = null;
  let label = "";
  if (pullback) {
    tactic = "pullback";
    label = "EMA 눌림";
  } else if (vwapReclaim) {
    tactic = "vwap";
    label = justReclaim ? "VWAP 회복" : "VWAP 근접";
  } else if (allowNewsBreak && orb) {
    tactic = "orb";
    label = preMode ? "PMH 돌파" : "ORH 돌파";
  } else if (allowNewsBreak && continuation) {
    tactic = "trend";
    label = "추세 지속";
  }

  const fire = Boolean(tactic);
  const wait = [];
  if (!inWindow) wait.push(intraday.session?.current?.note || "매수 시간이 아닙니다.");
  else {
    if (!pullback) wait.push("대기: 분봉 저가가 EMA9을 찍고 다시 올라오면 눌림 매수");
    if (!vwapReclaim) wait.push("대기: VWAP을 되밟거나 바로 위에서 받아내는 회복 매수");
    if (allowBreak && !orb) wait.push(preMode ? "대기: 프장 15분 고점(PMH)을 거래량과 함께 돌파" : "대기: 시초 15분 고점(ORH)을 거래량과 함께 돌파");
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
    orb,
    continuation,
    wait,
  };
}

function buildTradeTicket(action, setup, px, intraday, tactic) {
  const exec = executableLong(intraday.quote, px);
  const fill = exec.price ?? roundPx(px);
  const lv = tacticLevels(intraday, fill, tactic);
  const allowed = action === "당일 롱 관심";
  const tp = computeTakeProfit(intraday, { buyPrice: fill, sellPrice: lv.sellBase });
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
  const atr = intraday.atr || px * 0.003;
  const base = locked.sellPrice;
  if (base == null || px == null) {
    return { price: null, reason: "익절가를 못 짰습니다." };
  }
  if (rsi != null && rsi >= 75) {
    return { price: roundPx(px), reason: `RSI ${rsi.toFixed(1)} 과열 — 단타 익절` };
  }
  if (px > base) {
    const trail = roundPx(Math.max(base, px - atr * 0.6));
    return { price: trail, reason: `고점 추적 익절. RSI ${rsi?.toFixed?.(1) ?? "-"}` };
  }
  return { price: roundPx(base), reason: "검색 시 매도가 유지. RSI 과열·신고가일 때만 익절가 조정" };
}

function applyLockedTrade(plan, locked, intraday) {
  if (!plan?.trade) return plan;
  const live = plan.trade;
  const buyPrice = locked.buyPrice != null ? locked.buyPrice : live.buyPrice;
  const stopPrice = locked.stopPrice != null ? locked.stopPrice : live.stopPrice;
  const sellAnchor = locked.sellAnchor != null ? locked.sellAnchor : (locked.sellPrice ?? live.sellAnchor ?? live.sellPrice);
  const tp = computeTakeProfit(intraday, { buyPrice, sellPrice: sellAnchor });
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
    { name: "EMA 눌림", ok: picked.pullback },
    { name: "VWAP 회복", ok: picked.vwapReclaim },
    { name: preMode ? "PMH 돌파" : "ORH 돌파", ok: picked.orb },
    { name: "추세 지속", ok: picked.continuation },
    { name: "추격 아님", ok: picked.notChase },
    { name: "매수 시간", ok: picked.inWindow },
    { name: "뉴스 통과", ok: picked.newsOk },
  ];

  const reasons = [];
  const rules = [
    "프장 단타가 주력. 정규장은 눌림·VWAP만 보조.",
    "프장 15분 PMH 형성 후 돌파·VWAP·EMA. 정규 직전 20분·시초 15분·점심·마감은 신규 금지.",
    "프장 스프레드는 ASK 지정. 손절 0.7 ATR, 1R에서 익절.",
  ];

  let action = "관망";
  let setup = picked.inWindow ? "셋업 대기" : (intraday.session?.current?.name || "시간대 외");

  if (!picked.inWindow) {
    reasons.push(intraday.session?.current?.note || "매수 시간이 아닙니다.");
  } else if (!picked.notChase) {
    action = "추격 금지 / 되돌림 대기";
    setup = "과열 추격 금지";
    reasons.push(`RSI ${rsi?.toFixed?.(1) ?? "-"}, 시가대비 ${intraday.fromOpenPct.toFixed(2)}%. 눌림 올 때까지 안 삽니다.`);
  } else if (picked.fire) {
    action = "당일 롱 관심";
    setup = bias === "악재 우세" ? `축소 · ${picked.label}` : picked.label;
    reasons.push(`${picked.label} 셋업입니다. ASK/시장가로 바로 진입하고 1R에서 익절합니다.`);
    if (preMode) reasons.push("프장 주력 구간입니다. 스프레드를 보고 지정가로 넣습니다.");
    if (bias === "악재 우세") reasons.push("당일 악재가 있어 사이즈만 줄입니다. 돌파 추격은 하지 않습니다.");
    if (picked.mode === "pullback") reasons.push("정규 보조 구간이라 돌파 추격 없이 눌림·VWAP만 탑니다.");
  } else {
    setup = px < (intraday.vwap ?? px) ? "VWAP 아래 · 회복 대기" : "셋업 대기";
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
    volSpike: Number(intraday.volSpike.toFixed(2)),
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

async function livePack(symbol, bias, locked) {
  const [c1m, c1d, quote] = await Promise.all([
    yahooChart(symbol, "1m", "1d").catch(() => null),
    yahooChart(symbol, "1d", "5d").catch(() => null),
    yahooQuote(symbol).catch(() => null),
  ]);
  if (!c1m) throw new Error("1분봉을 못 가져왔습니다.");
  const chartQ = packQuote(c1m.meta);
  const merged = {
    last: quote?.last ?? chartQ?.last,
    bid: quote?.bid,
    ask: quote?.ask,
    bidSize: quote?.bidSize,
    askSize: quote?.askSize,
    marketState: quote?.marketState || chartQ?.marketState || "",
  };
  const intraday = buildIntraday(c1m, c1d, merged);
  let plan = dayTradePlan(intraday, bias);
  if (locked?.buyPrice != null || locked?.sellPrice != null) {
    plan = applyLockedTrade(plan, locked, intraday);
  }
  return {
    symbol: intraday?.symbol || symbol,
    price: intraday?.price,
    marketState: merged?.marketState || intraday?.marketState,
    candles: intraday?.candles || candlePayload(c1m),
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
        marketState: merged?.marketState || intraday.marketState,
      }
      : null,
    plan,
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
  const relVol = avgVol && volume != null ? volume / avgVol : null;
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
    relVol: relVol != null ? Number(relVol.toFixed(2)) : null,
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
      "?interval=1m&range=15m&includePrePost=true&region=US&lang=en-US";
  const data = await fetchJson(url);
  return data.chart?.result?.[0] || null;
}

function lastMinuteStats(chart) {
  const bars = barsFromChart(chart).filter((b) => b.c != null && b.v > 0);
  if (bars.length < 2) return null;
  const last = bars.at(-1);
  const prev = bars.at(-2);
  const hist = bars.slice(-16, -1);
  const avgVol = hist.length ? hist.reduce((s, b) => s + b.v, 0) / hist.length : last.v;
  const changePct = prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0;
  const relVol = avgVol ? last.v / avgVol : null;
  const volDelta = last.v - avgVol;
  const volSurgePct = avgVol ? ((last.v - avgVol) / avgVol) * 100 : null;
  const turnover = last.c * last.v;
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
    heat: Number((changePct * Math.min(Math.max(relVol || 1, 0.3), 8)).toFixed(1)),
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
  const byVol = [...listed].sort((a, b) => (b.volume || 0) - (a.volume || 0));
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
      if (!minute) return null;
      return { ...row, ...minute, name: row.name };
    } catch {
      return null;
    }
  });
  return mapped.filter(Boolean);
}

async function usGainers(params) {
  const listed = await listedUniverse();
  const q = String(params?.get?.("q") || "").trim();
  if (!q && Date.now() - minuteCache.at < 20000 && minuteCache.rows.length) {
    return minuteCache.rows;
  }
  if (q) return attachMinute(pickWatch(listed, q));
  const rows = await attachMinute(pickWatch(listed, ""));
  rows.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));
  minuteCache = { at: Date.now(), rows };
  return rows;
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
  const sort = params.get("sort") || "pct";
  const filtered = rows.filter((r) => {
    if (q) {
      const hay = `${r.symbol} ${r.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    } else if (r.changePct == null || r.changePct < minPct) {
      return false;
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
    : sort === "rel" || sort === "surge" ? "volSurgePct"
    : sort === "delta" ? "volDelta"
    : sort === "turnover" ? "turnover"
    : "changePct";
  filtered.sort((a, b) => (b[key] ?? -999) - (a[key] ?? -999));
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
      return json(res, 200, {
        asOf: new Date(minuteCache.at || Date.now()).toISOString(),
        market: "US",
        basis: "1m",
        universe: listedCache.rows.length || rows.length,
        scanned: rows.length,
        count: items.length,
        items,
        disclaimer: "1분봉 등락·거래량·거래대금 기준입니다. 지연 시세이며 투자 권유가 아닙니다.",
      });
    }
    if (url.pathname === "/api/scan") {
      return json(res, 200, await scan(url.searchParams.get("q") || ""));
    }
    if (url.pathname === "/api/chart") {
      const symbol = url.searchParams.get("symbol") || "";
      const bias = url.searchParams.get("bias") || "중립";
      if (!symbol) throw new Error("symbol 필요");
      const locked = {
        buyPrice: Number(url.searchParams.get("buy")) || null,
        sellPrice: Number(url.searchParams.get("sell")) || null,
        stopPrice: Number(url.searchParams.get("stop")) || null,
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
    if (!filePath.startsWith(PUBLIC_DIR)) {
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
