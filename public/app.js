const form = document.getElementById("search-form");
const input = document.getElementById("query");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");

let chart;
let volChart;
let candleSeries;
let vwapSeries;
let emaSeries;
let volumeSeries;
let syncingRange = false;
let pollTimer;
let refreshBusy = false;
let activeSymbol = "";
let activeBias = "중립";
let savedTimeRange = null;
let savedLogicalRange = null;
let lockedTrade = null;
let buyAlertAt = 0;
let buyPendingSince = 0;
let buyCooldownUntil = 0;
let ignoreRangeEvent = false;
let lastDrawnBarTime = 0;
let lastVolPoints = [];
let lastBarsByTime = new Map();
let lastIndicatorSnap = "";
let lastBuySignal = false;
let buyArmed = false;
let buyAlertOpen = false;
let buyMarkers = [];
let newsItems = [];
let newsFilter = "전체";

function renderNews() {
  const news = document.getElementById("news");
  const toolbar = document.getElementById("news-toolbar");
  if (!newsItems.length) {
    news.innerHTML = `<li class="title">해외 매체에서 7일 내 관련 뉴스를 못 찾았습니다.</li>`;
    if (toolbar) toolbar.innerHTML = "";
    return;
  }
  const channels = [...new Set(newsItems.map((i) => i.channel).filter(Boolean))];
  if (toolbar) {
    const chips = ["전체", "Stock Titan", ...channels.filter((c) => c !== "Stock Titan")];
    toolbar.innerHTML = chips
      .map((c) => {
        const n = c === "전체" ? newsItems.length : newsItems.filter((i) => i.channel === c).length;
        return `<button type="button" data-channel="${escapeHtml(c)}" class="${newsFilter === c ? "on" : ""}">${escapeHtml(c)} ${n}</button>`;
      })
      .join("");
    toolbar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        newsFilter = btn.dataset.channel;
        renderNews();
      });
    });
  }
  const shown = newsFilter === "전체" ? newsItems : newsItems.filter((i) => i.channel === newsFilter);
  news.innerHTML = shown
    .map(
      (item) => `
          <li>
            <a href="${item.url}" target="_blank" rel="noopener">
              <div class="row">
                <span class="label ${item.label}">${item.label}${item.fresh ? " · 24h" : ""}</span>
                <span class="sub">${fmtTime(item.publishedAt)}</span>
              </div>
              <p class="title">${escapeHtml(item.title)}</p>
              <p class="src">${escapeHtml(item.channel || item.publisher || item.source || "")}</p>
              <p class="sub">${escapeHtml(item.publisher || "")}${item.hits?.length ? " · " + item.hits.join(", ") : ""}</p>
            </a>
          </li>
        `,
    )
    .join("");
}

const boardStatus = document.getElementById("board-status");
const gainersBody = document.getElementById("gainers-body");
const moreGainers = document.getElementById("more-gainers");
let gainerTimer;
let gainerItems = [];
let gainerShown = 10;
let gainerEtDay = "";
const PAGE_SIZE = 10;
const MAX_GAINERS = 100;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  await runScan(q);
});

document.getElementById("refresh-gainers").addEventListener("click", () => loadGainers({ resetPage: true }));
for (const id of ["minPct", "minVol", "minTurnover", "minPrice", "maxPrice", "minRel", "sortBy"]) {
  document.getElementById(id).addEventListener("change", () => loadGainers({ resetPage: true }));
}
const boardQuery = document.getElementById("board-q");
let boardQTimer;
boardQuery.addEventListener("input", () => {
  clearTimeout(boardQTimer);
  boardQTimer = setTimeout(() => loadGainers({ resetPage: true }), 250);
});
boardQuery.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    clearTimeout(boardQTimer);
    loadGainers({ resetPage: true });
  }
});

async function loadGainers({ resetPage = false } = {}) {
  if (loadGainers.busy) return;
  loadGainers.busy = true;
  const params = new URLSearchParams({
    q: boardQuery.value.trim(),
    minPct: document.getElementById("minPct").value,
    minVol: document.getElementById("minVol").value,
    minTurnover: document.getElementById("minTurnover").value,
    minPrice: document.getElementById("minPrice").value,
    maxPrice: document.getElementById("maxPrice").value,
    minRel: document.getElementById("minRel").value,
    sort: document.getElementById("sortBy").value,
    limit: String(MAX_GAINERS),
  });
  if (!gainerItems.length) boardStatus.textContent = "키움 거래량급증 수집 중…";
  try {
    const res = await fetch("/api/gainers?" + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "급등주 조회 실패");
    const dayCol = document.getElementById("col-day");
    if (dayCol) dayCol.textContent = data.session === "POST" ? "애프터 등락" : "하루 등락";
    if (data.etDay && data.etDay !== gainerEtDay) {
      gainerEtDay = data.etDay;
      gainerShown = PAGE_SIZE;
    }
    const keep = resetPage ? PAGE_SIZE : gainerShown;
    gainerItems = (data.items || []).slice(0, MAX_GAINERS);
    gainerShown = Math.min(Math.max(keep, PAGE_SIZE), Math.max(gainerItems.length, PAGE_SIZE), MAX_GAINERS);
    renderGainers();
    const q = boardQuery.value.trim();
    boardStatus.textContent = `${data.session ? `${data.session} · ` : ""}${fmtTime(data.asOf)} · ${data.source === "kiwoom" ? "키움 거래량급증" : "1분봉"} ${data.scanned || 0}종 · ${gainerItems.length}개 중 ${Math.min(gainerShown, gainerItems.length)}개${q ? ` · "${q}"` : ""} · 실시간`;
  } catch (err) {
    if (!gainerItems.length) {
      boardStatus.textContent = err.message;
      gainersBody.innerHTML = `<tr><td colspan="11" class="empty">${escapeHtml(err.message)}</td></tr>`;
      moreGainers.hidden = true;
    }
  } finally {
    loadGainers.busy = false;
  }
}

function renderGainers() {
  const items = gainerItems.slice(0, gainerShown);
  if (!gainerItems.length) {
    gainersBody.innerHTML = `<tr><td colspan="11" class="empty">조건에 맞는 종목이 없습니다. 검색어나 필터를 바꿔 보세요.</td></tr>`;
    moreGainers.hidden = true;
    return;
  }
  gainersBody.innerHTML = items
    .map((row, i) => {
      const dayPct = row.dayChangePct ?? row.changePct;
      const minPct = row.minuteChangePct;
      const surge = row.volSurgePct;
      const delta = row.volDelta;
      const deltaTone = delta == null ? "" : delta >= 0 ? "up" : "down";
      const deltaTxt = delta == null
        ? "-"
        : `${delta >= 0 ? "+" : "-"}${fmtAmt(Math.abs(delta))}`;
      return `
      <tr data-symbol="${escapeHtml(row.symbol)}">
        <td>${i + 1}</td>
        <td class="ticker">${escapeHtml(row.symbol)}</td>
        <td class="name-cell">${escapeHtml(row.name)}</td>
        <td class="num">${row.price != null ? fmtNum(row.price) : "-"}</td>
        <td class="num ${pctTone(dayPct)}">${fmtPctSigned(dayPct, 2)}</td>
        <td class="num ${pctTone(minPct)}">${fmtPctSigned(minPct, 2)}</td>
        <td class="num">${fmtAmt(row.volume)}</td>
        <td class="num ${pctTone(surge)}">${fmtPctSigned(surge)}</td>
        <td class="num ${deltaTone}">${deltaTxt}</td>
        <td class="num">${fmtAmt(row.turnover)}</td>
        <td class="num"><span class="heat ${row.heat != null && row.heat < 0 ? "down" : ""}">${row.heat != null ? row.heat : "-"}</span></td>
      </tr>
    `;
    })
    .join("");
  const remain = gainerItems.length - gainerShown;
  moreGainers.hidden = remain <= 0;
  moreGainers.textContent = remain > 0 ? `${Math.min(PAGE_SIZE, remain)}개 더 보기` : "";
}

  moreGainers.addEventListener("click", () => {
  gainerShown = Math.min(gainerShown + PAGE_SIZE, MAX_GAINERS, gainerItems.length);
  renderGainers();
});

gainersBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-symbol]");
  if (!row) return;
  const symbol = row.dataset.symbol;
  input.value = symbol;
  runScan(symbol);
  document.getElementById("search-form").scrollIntoView({ behavior: "smooth" });
});

function pctTone(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n) >= 0 ? "up" : "down";
}

function fmtPctSigned(n, digits) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  const abs = Math.abs(v);
  const d = digits != null
    ? digits
    : abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const txt = abs.toLocaleString("en-US", {
    maximumFractionDigits: d,
    minimumFractionDigits: 0,
  });
  return `${v >= 0 ? "+" : "-"}${txt}%`;
}

function fmtAmt(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

loadGainers({ resetPage: true });
gainerTimer = setInterval(() => loadGainers(), 1000);

async function runScan(q) {
  statusEl.textContent = `"${q}" 해외 뉴스·1분봉 수집 중…`;
  result.hidden = true;
  stopPoll();
  try {
    const res = await fetch("/api/scan?q=" + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "검색 실패");
    const nextSymbol = data.company?.symbol || "";
    const resetView = nextSymbol !== activeSymbol;
    activeBias = data.condition || "중립";
    if (resetView) {
      lastBuySignal = false;
      buyArmed = false;
      buyAlertOpen = false;
      buyMarkers = [];
      lastBarsByTime = new Map();
      applyBuyMarkers();
      hideBuyAlert();
      lockedTrade = null;
      buyAlertAt = 0;
      buyPendingSince = 0;
      buyCooldownUntil = 0;
    } else if (!buyArmed) {
      lockedTrade = null;
    }
    render(data);
    drawChart(data.candles || [], data.plan, { resetView });
    handleBuySignal(data.plan, data.quote?.price ?? data.plan?.levels?.price);
    activeSymbol = nextSymbol;
    statusEl.textContent = `${fmtTime(data.asOf)} · 1분봉 1초 갱신`;
    result.hidden = false;
    if (activeSymbol) startPoll();
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function render(data) {
  const company = data.company;
  const plan = data.plan || {};
  document.getElementById("company-name").textContent = company
    ? `${company.name} (${company.symbol})`
    : data.query;
  document.getElementById("company-meta").textContent = company
    ? `${company.exchange} · ${data.quote?.marketState || plan.stats?.marketState || "-"} · 후보 ${data.candidates.map((c) => c.symbol).join(", ") || "-"}`
    : "US 티커를 확정하지 못했습니다.";

  renderQuote(data.quote);
  const badge = document.getElementById("condition");
  badge.textContent = data.condition;
  badge.className = "badge " + tone(data.condition);
  const tradePlan = buyArmed && lockedTrade
    ? {
      trade: {
        ...(plan.trade || {}),
        buyPrice: lockedTrade.buyPrice ?? plan.trade?.buyPrice,
        buyReason: lockedTrade.buyReason ?? plan.trade?.buyReason,
        stopPrice: lockedTrade.stopPrice ?? plan.trade?.stopPrice,
        stopReason: lockedTrade.stopReason ?? plan.trade?.stopReason,
      },
    }
    : plan;
  renderTrade(tradePlan);
  renderSession(plan.session);
  renderPlan(plan);

  if (data.counts) {
    const titan = (data.items || []).filter((i) => i.channel === "Stock Titan").length;
    document.getElementById("counts").innerHTML = `
      <span>해외 ${data.counts.total}</span>
      <span>24h ${data.counts.fresh}</span>
      <span>호재 ${data.counts.positive}</span>
      <span>악재 ${data.counts.negative}</span>
      ${titan ? `<span>Stock Titan ${titan}</span>` : ""}
    `;
  }

  if (data.items) {
    newsItems = data.items;
    newsFilter = "전체";
    renderNews();
  }
  if (data.disclaimer) document.getElementById("disclaimer").textContent = data.disclaimer;
}

function renderQuote(quote) {
  const priceEl = document.getElementById("price");
  const changeEl = document.getElementById("change");
  if (quote?.price != null) {
    priceEl.textContent = `${fmtNum(quote.price)} ${quote.currency || ""}`.trim();
    const sign = quote.change >= 0 ? "+" : "";
    const book = [
      quote.bid != null ? `BID ${fmtNum(quote.bid)}` : null,
      quote.ask != null ? `ASK ${fmtNum(quote.ask)}` : null,
    ].filter(Boolean).join(" · ");
    changeEl.textContent = `${sign}${fmtNum(quote.change)} (${sign}${Number(quote.changePct).toFixed(2)}%)${book ? ` · ${book}` : ""}`;
    changeEl.className = "change " + (quote.change >= 0 ? "up" : "down");
  } else {
    priceEl.textContent = "시세 없음";
    changeEl.textContent = "";
  }
}

function isBuySignal(plan) {
  return Boolean(plan?.buySignal || plan?.trade?.allowed || plan?.action === "당일 롱 관심");
}

function buyAlertText(trade) {
  const liveBuy = trade.buyLivePrice ?? trade.buyPrice;
  return `${trade.buyLiveExecutable ? "지금 ASK에 매수" : "호가 대기"} ${fmtNum(liveBuy)} · ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`;
}

function alertPx(v) {
  return v != null && Number.isFinite(Number(v)) ? fmtNum(v) : "-";
}

function fillAlertLevels(trade) {
  const buy = trade.buyLivePrice ?? trade.buyPrice;
  const sell = trade.takeProfit ?? trade.sellPrice;
  const stop = trade.stopLivePrice ?? trade.stopPrice;
  const buyEl = document.getElementById("alert-buy-price");
  const sellEl = document.getElementById("alert-sell-price");
  const stopEl = document.getElementById("alert-stop-price");
  if (buyEl) buyEl.textContent = alertPx(buy);
  if (sellEl) sellEl.textContent = alertPx(sell);
  if (stopEl) stopEl.textContent = alertPx(stop);
}

function showBuyAlert(trade, { pulse = false } = {}) {
  const box = document.getElementById("buy-alert");
  const detail = document.getElementById("buy-alert-detail");
  detail.textContent = buyAlertText(trade);
  fillAlertLevels(trade);
  box.hidden = false;
  if (pulse) {
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = "";
  }
}

function hideBuyAlert() {
  const box = document.getElementById("buy-alert");
  if (box) box.hidden = true;
}

function planPrice(plan, fallback) {
  const n = Number(fallback ?? plan?.levels?.price ?? plan?.trade?.buyLivePrice ?? plan?.trade?.buyPrice);
  return Number.isFinite(n) ? n : null;
}

function buyAlertShouldClose(px, entry) {
  if (buyAlertAt && Date.now() - buyAlertAt >= 60 * 1000) return "time";
  if (px == null || entry == null || !(entry > 0)) return false;
  if (px <= entry * 0.9) return "down";
  const stop = Number(lockedTrade?.stopPrice);
  if (Number.isFinite(stop) && px <= stop) return "down";
  const t5 = Number(lockedTrade?.sellAnchor);
  if (Number.isFinite(t5) && px >= t5) return "up";
  const t10 = Number(lockedTrade?.sellStretch);
  if (Number.isFinite(t10) && px >= t10) return "up";
  return false;
}

function closeBuyAlert(signalStillOn) {
  hideBuyAlert();
  buyAlertOpen = false;
  buyArmed = false;
  buyAlertAt = 0;
  buyPendingSince = 0;
  lastBuySignal = Boolean(signalStillOn);
  buyCooldownUntil = Date.now() + 1500;
}

function latestCandleTime() {
  let latest = null;
  for (const t of lastBarsByTime.keys()) {
    if (latest == null || t > latest) latest = t;
  }
  return latest ?? Math.floor(Date.now() / 1000 / 60) * 60;
}

function applyBuyMarkers() {
  if (candleSeries) {
    candleSeries.setMarkers(
      [...buyMarkers].sort((a, b) => a.time - b.time),
    );
  }
  const btn = document.getElementById("reset-buy-marks");
  if (btn) btn.disabled = buyMarkers.length === 0;
}

function addBuyMarker(time) {
  const t = Number(time);
  if (!Number.isFinite(t)) return;
  if (buyMarkers.some((m) => m.time === t)) return;
  buyMarkers.push({
    time: t,
    position: "belowBar",
    color: "#3ee0a2",
    shape: "arrowUp",
    text: "매수",
    size: 1,
  });
  applyBuyMarkers();
}

function handleBuySignal(plan, livePrice) {
  const trade = plan?.trade || {};
  const px = planPrice(plan, livePrice);
  const entry = Number(lockedTrade?.alertPrice ?? lockedTrade?.buyPrice);
  const on = isBuySignal(plan);
  const shown = {
    ...trade,
    buyPrice: lockedTrade?.buyPrice ?? trade.buyPrice,
    buyReason: lockedTrade?.buyReason ?? trade.buyReason,
    stopPrice: lockedTrade?.stopPrice ?? trade.stopPrice,
    stopReason: lockedTrade?.stopReason ?? trade.stopReason,
  };

  if (buyAlertOpen) {
    if (!on || buyAlertShouldClose(px, entry)) {
      closeBuyAlert(on);
      return;
    }
    fillAlertLevels(shown);
    lastBuySignal = true;
    return;
  }

  if (!on) {
    lastBuySignal = false;
    buyPendingSince = 0;
    return;
  }
  if (Date.now() < buyCooldownUntil) return;
  if (lastBuySignal) return;
  if (!buyPendingSince) buyPendingSince = Date.now();
  if (Date.now() - buyPendingSince < 4000) return;

  const alertPrice = trade.buyLivePrice ?? trade.buyPrice;
  lockedTrade = {
    ...lockedTrade,
    alertPrice,
    alertAt: Date.now(),
    buyPrice: alertPrice,
    buyReason: `매수 타이밍 고정 ${fmtNum(alertPrice)} · 5~10분`,
    sellAnchor: trade.sellAnchor ?? trade.sellPrice,
    sellStretch: trade.sellStretch,
    stopPrice: trade.stopPrice,
    stopReason: trade.stopReason || `매수 타이밍 손절 ${fmtNum(trade.stopPrice)}`,
  };
  buyAlertAt = lockedTrade.alertAt;
  shown.buyPrice = lockedTrade.buyPrice;
  shown.stopPrice = lockedTrade.stopPrice;
  buyAlertOpen = true;
  buyArmed = true;
  lastBuySignal = true;
  showBuyAlert(shown, { pulse: true });
  addBuyMarker(latestCandleTime());
}

function renderTrade(plan) {
  if (!buyAlertOpen) return;
  fillAlertLevels(plan.trade || {});
}

function renderSession(session) {
  const nowEl = document.getElementById("session-now");
  const slotsEl = document.getElementById("session-slots");
  if (!session) {
    nowEl.textContent = "정규장 세션 정보를 못 받았습니다.";
    slotsEl.innerHTML = "";
    return;
  }
  const cur = session.current || {};
  nowEl.textContent = `지금 ${session.nowKst} KST · ${cur.name} · ${cur.buy ? "매수 가능 시간" : "매수 금지 시간"}${cur.untilKst ? ` (이 구간 ${cur.untilKst} KST까지)` : ""} — ${cur.note || ""}`;
  nowEl.className = "session-now " + (cur.buy ? "open" : "closed");
  slotsEl.innerHTML = (session.slots || [])
    .map((s) => {
      const tag = !s.buy ? " · 금지" : s.mode === "pullback" ? " · 눌림만" : " · 매수";
      return `<li class="${s.buy ? "open" : "closed"}">${escapeHtml(s.name)} · KST ${escapeHtml(s.kst)}${tag}</li>`;
    })
    .join("");
}

function oscTone(v, overbought, oversold) {
  if (v == null) return "";
  if (v >= overbought) return "warn";
  if (v <= oversold) return "down";
  return "up";
}

function oscHint(v, overbought, oversold) {
  if (v == null) return "";
  if (v >= overbought) return "과열";
  if (v <= oversold) return "침체";
  return "중립";
}

function meterClass(v, overbought, oversold) {
  if (v == null) return "";
  if (v >= overbought) return "hot";
  if (v <= oversold) return "cold";
  return "ok";
}

function signedPct(v) {
  if (v == null) return "-";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function signTone(v) {
  if (v == null) return "";
  return Number(v) >= 0 ? "up" : "down";
}

const IND_TIPS = {
  "RSI(14)": "최근 14개 1분봉의 상승·하락 강도입니다. 70 이상은 과열(단기 조정 가능), 30 이하는 침체(반등 가능)로 봅니다.",
  "Stoch %K": "최근 고점·저점 사이에서 현재가가 어디쯤인지를 0~100으로 표시합니다. RSI보다 반응이 빠르고, 80 이상은 과열, 20 이하는 침체입니다.",
  "MACD": "단기와 장기 이동평균의 차이입니다. 0 위면 단기 모멘텀이 강하고, 0 아래면 약합니다.",
  "MACD hist": "MACD와 시그널선의 간격입니다. 막대가 커지면 가속, 줄어들면 모멘텀이 꺾이는 신호입니다.",
  "현재가": "지금 체결가입니다. 프장에는 프리마켓 가격을 씁니다.",
  "EMA9": "최근 9분 지수이동평균입니다. 단기 추세선이고, 가격이 이 선 위에 있으면 단기 매수세가 우세합니다.",
  "EMA21": "최근 21분 지수이동평균입니다. 중기 추세선이고, EMA9이 EMA21 위에 있으면 단기 상승 우세로 봅니다.",
  "VWAP": "거래량으로 가중한 평균가입니다. 세션(프장/본장/애프터)마다 리셋되며, 이 선 위면 매수 우위, 아래면 매도 우위로 봅니다.",
  "VWAP 이격": "현재가가 VWAP에서 얼마나 떨어져 있는지의 비율입니다. 플러스는 VWAP 위, 마이너스는 VWAP 아래입니다.",
  "ATR": "최근 1분봉 평균 진폭입니다. 5분·10분 익절과 손절 거리를 이 값으로 잡습니다.",
  "1분 거래량": "지금 만들고 있는 1분봉에서 체결된 주식 수입니다. 프장에는 키움 1분 거래량을 씁니다.",
  "상대거래량": "최근 1분 평균 거래량 대비 배수입니다. 1.5배 이상이면 갑자기 돈이 들어온 구간으로 봅니다.",
  "1분 거래대금": "1분 거래량 × 현재가입니다. 주수보다 실제 돈의 크기를 볼 때 씁니다.",
  "당일 거래량": "오늘 세션에서 누적된 거래량입니다.",
  "당일 거래대금": "오늘 세션에서 누적된 거래대금입니다.",
  "PMH": "오늘 프장 고가입니다. 이 가격을 돌파하면 모멘텀이 이어질 수 있고, 막히면 되돌림을 경계합니다.",
  "PML": "오늘 프장 저가입니다. 이 가격이 깨지면 약세로 보고, 지키면 지지로 봅니다.",
  "ORH": "정규장 초반 고가(오프닝 레인지 고점)입니다. 돌파 시 장중 모멘텀, 실패 시 되돌림 구간으로 봅니다.",
  "ORL": "정규장 초반 저가(오프닝 레인지 저점)입니다. 이탈하면 약세, 지키면 지지로 봅니다.",
  "갭": "전일 종가 대비 오늘 시가(또는 프장가)의 차이입니다. 갭 업은 강세 출발, 갭 다운은 약세 출발입니다.",
};

function indCard({ key, display, tone, hint, meter, span, flash, tip }) {
  const flashCls = flash ? " flash" : "";
  const meterHtml = meter != null
    ? `<div class="meter ${meter.cls}"><i style="width:${Math.max(0, Math.min(100, meter.pct))}%"></i></div>`
    : "";
  const hintHtml = hint ? `<span class="ind-hint">${escapeHtml(hint)}</span>` : "";
  const help = tip || IND_TIPS[key];
  const keyAttrs = help ? ` tabindex="0" title=""` : "";
  const helpMark = help ? `<i class="ind-help" aria-hidden="true">?</i>` : "";
  const tipHtml = help ? `<span class="ind-tip" role="tooltip">${escapeHtml(help)}</span>` : "";
  return `<div class="ind-card${span ? " span2" : ""}" data-key="${escapeHtml(key)}">
    <span class="ind-k"${keyAttrs}>${escapeHtml(key)}${helpMark}${tipHtml}</span>
    <strong class="ind-v ${tone || ""}${flashCls}">${escapeHtml(display)}</strong>
    ${meterHtml}${hintHtml}
  </div>`;
}

function indGroup(title, cards, wide) {
  const items = cards.filter(Boolean);
  if (!items.length) return "";
  return `<section class="ind-group">
    <h3>${escapeHtml(title)}</h3>
    <div class="ind-grid${wide ? " wide" : ""}">${items.join("")}</div>
  </section>`;
}

function renderPlan(plan) {
  const actionEl = document.getElementById("plan-action");
  const action = plan.action || "-";
  actionEl.textContent = action;
  actionEl.classList.toggle("hot", action.includes("관심") || action.includes("매수"));
  actionEl.classList.toggle("cold", action.includes("관망") || action.includes("대기") || action.includes("금지"));
  document.getElementById("plan-setup").textContent = plan.setup || "";
  const stamp = document.getElementById("ind-stamp");
  if (stamp) {
    stamp.textContent = `보조지표 · ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`;
  }
  document.getElementById("plan-reasons").innerHTML = (plan.reasons || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  document.getElementById("plan-rules").innerHTML = (plan.rules || [])
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  document.getElementById("checks").innerHTML = (plan.checks || [])
    .map((c) => `<span class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "×"} ${escapeHtml(c.name)}</span>`)
    .join("");

  const ind = plan.indicators || {};
  const lv = plan.levels || {};
  const st = plan.stats || {};
  const preTape = String(st.marketState || plan.session?.current?.mode || "").toUpperCase().includes("PRE")
    || plan.session?.current?.mode === "pre";
  const snap = JSON.stringify([ind, lv.price, lv.orh, lv.orl, st.gapPct]);
  const changed = snap !== lastIndicatorSnap;
  lastIndicatorSnap = snap;

  const emaHint = ind.ema9 != null && ind.ema21 != null
    ? (ind.ema9 >= ind.ema21 ? "단기 위" : "단기 아래")
    : "";
  const card = (opts) => indCard({ ...opts, flash: changed });

  document.getElementById("levels").innerHTML = [
    indGroup("모멘텀", [
      ind.rsi != null && card({
        key: "RSI(14)",
        display: Number(ind.rsi).toFixed(1),
        tone: oscTone(ind.rsi, 70, 30),
        hint: oscHint(ind.rsi, 70, 30),
        meter: { pct: ind.rsi, cls: meterClass(ind.rsi, 70, 30) },
      }),
      ind.stoch != null && card({
        key: "Stoch %K",
        display: Number(ind.stoch).toFixed(1),
        tone: oscTone(ind.stoch, 80, 20),
        hint: oscHint(ind.stoch, 80, 20),
        meter: { pct: ind.stoch, cls: meterClass(ind.stoch, 80, 20) },
      }),
      ind.macd != null && card({
        key: "MACD",
        display: Number(ind.macd).toFixed(4),
        tone: signTone(ind.macd),
        hint: Number(ind.macd) >= 0 ? "양수" : "음수",
      }),
      ind.macdHist != null && card({
        key: "MACD hist",
        display: Number(ind.macdHist).toFixed(4),
        tone: signTone(ind.macdHist),
        hint: Number(ind.macdHist) >= 0 ? "가속" : "감속",
      }),
    ]),
    indGroup("추세 · 가격", [
      lv.price != null && card({ key: "현재가", display: fmtNum(lv.price) }),
      ind.ema9 != null && card({ key: "EMA9", display: fmtNum(ind.ema9), hint: emaHint }),
      ind.ema21 != null && card({ key: "EMA21", display: fmtNum(ind.ema21) }),
      ind.vwap != null && card({ key: "VWAP", display: fmtNum(ind.vwap) }),
      ind.vsVwapPct != null && card({
        key: "VWAP 이격",
        display: signedPct(ind.vsVwapPct),
        tone: signTone(ind.vsVwapPct),
        hint: Number(ind.vsVwapPct) >= 0 ? "위" : "아래",
      }),
      ind.atr != null && card({ key: "ATR", display: fmtNum(ind.atr) }),
    ], true),
    indGroup("거래량", [
      ind.lastVolume > 0 && card({
        key: "1분 거래량",
        display: fmtAmt(ind.lastVolume),
        hint: "1초 갱신",
      }),
      ind.relVol > 0 && card({
        key: "상대거래량",
        display: `${Number(ind.relVol).toFixed(2)}x`,
        tone: Number(ind.relVol) >= 1.5 ? "up" : "",
      }),
      ind.lastTurnover > 0 && card({ key: "1분 거래대금", display: String(ind.lastTurnoverLabel), hint: "실시간" }),
      ind.volume > 0 && card({ key: "당일 거래량", display: fmtAmt(ind.volume), hint: "실시간" }),
      ind.turnover > 0 && card({ key: "당일 거래대금", display: String(ind.turnoverLabel), span: true }),
    ]),
    indGroup("레벨", [
      lv.orh != null && card({ key: preTape ? "PMH" : "ORH", display: fmtNum(lv.orh) }),
      lv.orl != null && card({ key: preTape ? "PML" : "ORL", display: fmtNum(lv.orl) }),
      st.gapPct != null && card({
        key: "갭",
        display: signedPct(st.gapPct),
        tone: signTone(st.gapPct),
      }),
    ], true),
  ].join("");
  restoreIndTip();
}

function chartTheme() {
  return {
    layout: { background: { color: "#141a2e" }, textColor: "#9aa6c8" },
    grid: { vertLines: { color: "#2a3354" }, horzLines: { color: "#2a3354" } },
    rightPriceScale: { borderColor: "#2a3354" },
    localization: { timeFormatter: (time) => etClock(time) },
    autoSize: true,
    handleScroll: {
      mouseWheel: false,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
    },
  };
}

function ensureChart() {
  if (chart) return;
  const el = document.getElementById("chart");
  const volEl = document.getElementById("chart-vol");
  chart = LightweightCharts.createChart(el, {
    ...chartTheme(),
    timeScale: {
      borderColor: "#2a3354",
      visible: false,
      timeVisible: false,
      secondsVisible: false,
    },
  });
  volChart = LightweightCharts.createChart(volEl, {
    ...chartTheme(),
    handleScroll: {
      mouseWheel: false,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: false },
      axisDoubleClickReset: true,
    },
    timeScale: {
      borderColor: "#2a3354",
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => etClock(time),
    },
  });
  new ResizeObserver(() => {
    chart?.applyOptions({});
    volChart?.applyOptions({});
  }).observe(el.parentElement || el);
  candleSeries = chart.addCandlestickSeries({
    upColor: "#3ee0a2",
    downColor: "#ff6b7a",
    borderVisible: false,
    wickUpColor: "#3ee0a2",
    wickDownColor: "#ff6b7a",
  });
  candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.08 } });
  vwapSeries = chart.addLineSeries({ color: "#6ea8ff", lineWidth: 2, priceLineVisible: false });
  emaSeries = chart.addLineSeries({ color: "#f5c15c", lineWidth: 1, priceLineVisible: false });
  volumeSeries = volChart.addHistogramSeries({
    priceFormat: { type: "volume" },
    lastValueVisible: false,
    priceLineVisible: false,
    baseLineVisible: false,
  });
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.12, bottom: 0.02 },
    borderVisible: false,
  });
  const syncFrom = (source, target) => (range) => {
    if (ignoreRangeEvent || syncingRange || !range) return;
    syncingRange = true;
    try {
      target.timeScale().setVisibleLogicalRange(range);
    } catch {}
    syncingRange = false;
    if (source === chart) {
      savedLogicalRange = range;
      savedTimeRange = chart.timeScale().getVisibleRange();
      applyVolumeScale(savedTimeRange);
    }
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(chart, volChart));
  volChart.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(volChart, chart));
  bindChartTip();
}

function estimateBuySell(bar) {
  const v = Number(bar.volume) || 0;
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  if (!(v > 0)) return { buy: 0, sell: 0 };
  const range = high - low;
  if (!(range > 0) || ![high, low, close].every(Number.isFinite)) {
    return { buy: v / 2, sell: v / 2 };
  }
  const buy = v * Math.min(1, Math.max(0, (close - low) / range));
  return { buy, sell: Math.max(0, v - buy) };
}

function bindChartTip() {
  const tip = document.getElementById("chart-tip");
  const host = document.getElementById("chart")?.parentElement;
  if (!chart || !tip || !host || tip.dataset.bound) return;
  tip.dataset.bound = "1";
  const showTip = (param, origin) => {
    if (!param?.point || param.time == null) {
      tip.hidden = true;
      return;
    }
    const t = typeof param.time === "object" ? param.time : Number(param.time);
    const bar = lastBarsByTime.get(t) || lastBarsByTime.get(Number(t));
    const candle = param.seriesData.get(candleSeries);
    if (!bar && !candle) {
      tip.hidden = true;
      return;
    }
    const open = candle?.open ?? bar.open;
    const high = candle?.high ?? bar.high;
    const low = candle?.low ?? bar.low;
    const close = candle?.close ?? bar.close;
    const volume = bar?.volume ?? 0;
    const flow = estimateBuySell({ open, high, low, close, volume });
    const up = close >= open;
    const chg = open ? ((close - open) / open) * 100 : 0;
    tip.innerHTML = `
      <p class="tip-time">${etClock(Number(t))}</p>
      <div class="tip-row"><span class="tip-k">시가</span><span class="tip-v">${fmtNum(open)}</span></div>
      <div class="tip-row"><span class="tip-k">고가</span><span class="tip-v">${fmtNum(high)}</span></div>
      <div class="tip-row"><span class="tip-k">저가</span><span class="tip-v">${fmtNum(low)}</span></div>
      <div class="tip-row"><span class="tip-k">종가</span><span class="tip-v ${up ? "up" : "down"}">${fmtNum(close)} ${signedPct(chg)}</span></div>
      <div class="tip-split"></div>
      <div class="tip-row"><span class="tip-k">거래량</span><span class="tip-v">${fmtAmt(volume)}</span></div>
      <div class="tip-row"><span class="tip-k">매수량</span><span class="tip-v up">${fmtAmt(flow.buy)}</span></div>
      <div class="tip-row"><span class="tip-k">매도량</span><span class="tip-v down">${fmtAmt(flow.sell)}</span></div>
      <p class="tip-note">매수·매도는 종가 위치로 추정한 값입니다.</p>
    `;
    tip.hidden = false;
    const pad = 10;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const originTop = origin === volChart ? (document.getElementById("chart")?.clientHeight || 0) : 0;
    let left = param.point.x + 14;
    let top = originTop + param.point.y + 14;
    if (left + tw > host.clientWidth - pad) left = param.point.x - tw - 14;
    if (top + th > host.clientHeight - pad) top = originTop + param.point.y - th - 14;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  chart.subscribeCrosshairMove((param) => showTip(param, chart));
  volChart.subscribeCrosshairMove((param) => showTip(param, volChart));
}

function applyVolumeScale(range) {
  if (!volumeSeries) return;
  const view = range || chart.timeScale().getVisibleRange();
  let max = lastVolPoints.at(-1)?.value || 0;
  for (const point of lastVolPoints) {
    if (!view || (point.time >= view.from && point.time <= view.to)) {
      max = Math.max(max, point.value || 0);
    }
  }
  volumeSeries.applyOptions({
    autoscaleInfoProvider: () => ({
      priceRange: { minValue: 0, maxValue: max > 0 ? max * 1.2 : 1 },
    }),
  });
}

function etClock(ts) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ts * 1000));
}

function sessionOverlay(candles, period = 9) {
  const k = 2 / (period + 1);
  let session = null;
  let ema = null;
  let pv = 0;
  let vol = 0;
  const vwap = [];
  const emaLine = [];
  for (const c of candles) {
    if (c.session !== session) {
      session = c.session;
      ema = c.close;
      pv = 0;
      vol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume || 0;
    pv += typical * v;
    vol += v;
    ema = ema == null ? c.close : c.close * k + ema * (1 - k);
    vwap.push({ time: c.time, value: vol ? pv / vol : c.close });
    emaLine.push({ time: c.time, value: ema });
  }
  return { vwap, ema: emaLine };
}

function sessionFocusRange(data) {
  const last = data.at(-1);
  if (!last || (last.session !== "pre" && last.session !== "post")) return null;
  let i = data.length - 1;
  while (i > 0 && data[i - 1].session === last.session) i -= 1;
  if (data.length - i < 8) return null;
  return { from: data[i].time, to: last.time + 60 };
}

function followLiveLogicalRange(keepLogical, data, prevLastTime) {
  const from = Number(keepLogical?.from);
  const to = Number(keepLogical?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !data.length) return keepLogical;
  const newBarCount = prevLastTime
    ? data.filter((c) => c.time > prevLastTime).length
    : 0;
  if (!(newBarCount > 0)) return keepLogical;
  const prevLastIndex = data.length - 1 - newBarCount;
  if (to < prevLastIndex - 1.5) return keepLogical;
  return { from: from + newBarCount, to: to + newBarCount };
}

function drawChart(candles, plan, { resetView = false } = {}) {
  ensureChart();
  const keepLogical = !resetView && (savedLogicalRange || chart.timeScale().getVisibleLogicalRange());
  const data = candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
    session: c.session,
  }));
  ignoreRangeEvent = true;
  const overlay = sessionOverlay(data, 9);
  candleSeries.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  vwapSeries.setData(overlay.vwap);
  emaSeries.setData(overlay.ema);
  lastVolPoints = data.map((c) => {
    const up = c.close >= c.open;
    let color = up ? "rgba(62,224,162,0.85)" : "rgba(255,107,122,0.85)";
    if (c.session === "pre") color = "rgba(245,193,92,0.9)";
    if (c.session === "post") color = "rgba(110,168,255,0.88)";
    if (c.session === "other") color = "rgba(154,166,200,0.4)";
    return { time: c.time, value: c.volume > 0 ? c.volume : 0, color };
  });
  lastBarsByTime = new Map(data.map((c) => [c.time, c]));
  volumeSeries.setData(lastVolPoints);
  applyLines();
  applyBuyMarkers();
  const last = data.at(-1);
  if (resetView) lastDrawnBarTime = 0;
  if (resetView || !keepLogical) {
    const focus = sessionFocusRange(data);
    if (focus) {
      chart.timeScale().setVisibleRange(focus);
      volChart.timeScale().setVisibleRange(focus);
    } else {
      chart.timeScale().fitContent();
      volChart.timeScale().fitContent();
    }
    savedLogicalRange = chart.timeScale().getVisibleLogicalRange();
    if (savedLogicalRange) volChart.timeScale().setVisibleLogicalRange(savedLogicalRange);
  } else {
    const next = followLiveLogicalRange(keepLogical, data, lastDrawnBarTime);
    chart.timeScale().setVisibleLogicalRange(next);
    volChart.timeScale().setVisibleLogicalRange(next);
    savedLogicalRange = next;
  }
  savedTimeRange = chart.timeScale().getVisibleRange();
  applyVolumeScale(savedTimeRange);
  lastDrawnBarTime = last?.time || lastDrawnBarTime;
  ignoreRangeEvent = false;
}

function applyLines() {
  if (!candleSeries?._radarMap) {
    if (candleSeries) candleSeries._radarMap = {};
    return;
  }
  for (const key of Object.keys(candleSeries._radarMap)) {
    try { candleSeries.removePriceLine(candleSeries._radarMap[key]); } catch {}
    delete candleSeries._radarMap[key];
  }
}

function startPoll() {
  stopPoll();
  refreshChart();
  pollTimer = setInterval(refreshChart, 1000);
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshChart() {
  if (!activeSymbol || refreshBusy) return;
  refreshBusy = true;
  try {
    const params = new URLSearchParams({
      symbol: activeSymbol,
      bias: activeBias,
    });
    const recast = !buyArmed || !lastBuySignal;
    if (buyArmed && lockedTrade?.sellAnchor != null) params.set("sell", String(lockedTrade.sellAnchor));
    if (buyArmed && lockedTrade?.sellStretch != null) params.set("sell10", String(lockedTrade.sellStretch));
    if (buyArmed && lockedTrade?.alertAt) params.set("since", String(lockedTrade.alertAt));
    if (!recast && lockedTrade?.buyPrice != null) {
      params.set("buy", String(lockedTrade.buyPrice));
      params.set("stop", String(lockedTrade.stopPrice ?? ""));
    }
    const res = await fetch("/api/chart?" + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.quote) renderQuote(data.quote);
    else if (data.price != null) document.getElementById("price").textContent = fmtNum(data.price);
    if (data.plan) {
      if (data.candles?.length) drawChart(data.candles, data.plan, { resetView: false });
      handleBuySignal(data.plan, data.price ?? data.quote?.price);
      renderTrade(data.plan);
      renderSession(data.plan.session);
      renderPlan(data.plan);
    }
    document.getElementById("chart-live").textContent =
      `${data.marketState || data.plan?.stats?.marketState || ""} · 실시간 현재가 ${fmtNum(data.price ?? data.quote?.price ?? "")} · ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`;
  } catch (err) {
    document.getElementById("chart-live").textContent = err.message;
  } finally {
    refreshBusy = false;
  }
}

function tone(condition) {
  if (condition.includes("호재")) return "good";
  if (condition.includes("악재") || condition.includes("금지")) return "bad";
  return "warn";
}

function fmtNum(n) {
  const x = Number(n);
  const digits = !Number.isFinite(x) ? 2 : x >= 1 ? 4 : 6;
  return x.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function fmtTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { hour12: false });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let lastIndPoint = null;

function restoreIndTip() {
  const board = document.getElementById("levels");
  if (!board) return;
  board.querySelectorAll(".ind-k.is-open").forEach((el) => el.classList.remove("is-open"));
  if (!lastIndPoint) return;
  const under = document.elementFromPoint(lastIndPoint.x, lastIndPoint.y);
  const key = under?.closest?.(".ind-k");
  if (key && board.contains(key) && key.querySelector(".ind-tip")) key.classList.add("is-open");
}

function bindIndTips() {
  const board = document.getElementById("levels");
  if (!board || board.dataset.tipsBound) return;
  board.dataset.tipsBound = "1";
  board.addEventListener("pointermove", (e) => {
    lastIndPoint = { x: e.clientX, y: e.clientY };
  });
  board.addEventListener("pointerleave", () => {
    lastIndPoint = null;
    board.querySelectorAll(".ind-k.is-open").forEach((el) => el.classList.remove("is-open"));
  });
}

bindIndTips();
document.getElementById("reset-buy-marks")?.addEventListener("click", () => {
  buyMarkers = [];
  applyBuyMarkers();
});
window.addEventListener("resize", () => chart?.applyOptions({}));

const preset = new URLSearchParams(location.search).get("q");
if (preset) {
  input.value = preset;
  runScan(preset);
}
