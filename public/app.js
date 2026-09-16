const form = document.getElementById("search-form");
const input = document.getElementById("query");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");

let chart;
let candleSeries;
let vwapSeries;
let emaSeries;
let volumeSeries;
let pollTimer;
let refreshBusy = false;
let activeSymbol = "";
let activeBias = "중립";
let savedTimeRange = null;
let lockedTrade = null;
let ignoreRangeEvent = false;
let lastChartSpan = 0;
let lastAutoFocus = "";
let lastVolPoints = [];
let lastBarsByTime = new Map();
let lastIndicatorSnap = "";
let lastBuySignal = false;
let buyArmed = false;
let buyAlertSpent = false;
let buyAlertOpen = false;
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
const PAGE_SIZE = 10;
const MAX_GAINERS = 100;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  await runScan(q);
});

document.getElementById("refresh-gainers").addEventListener("click", () => loadGainers());
for (const id of ["minPct", "minVol", "minTurnover", "minPrice", "maxPrice", "minRel", "sortBy"]) {
  document.getElementById(id).addEventListener("change", () => loadGainers());
}
const boardQuery = document.getElementById("board-q");
let boardQTimer;
boardQuery.addEventListener("input", () => {
  clearTimeout(boardQTimer);
  boardQTimer = setTimeout(() => loadGainers(), 250);
});
boardQuery.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    clearTimeout(boardQTimer);
    loadGainers();
  }
});

async function loadGainers() {
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
  boardStatus.textContent = "1분봉 급등주 수집 중…";
  try {
    const res = await fetch("/api/gainers?" + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "급등주 조회 실패");
    gainerItems = (data.items || []).slice(0, MAX_GAINERS);
    gainerShown = PAGE_SIZE;
    renderGainers();
    const q = boardQuery.value.trim();
    boardStatus.textContent = `${data.session ? `${data.session} · ` : ""}${fmtTime(data.asOf)} · 1분봉 ${data.scanned || 0}종 스캔 · ${gainerItems.length}개 중 ${Math.min(gainerShown, gainerItems.length)}개${q ? ` · "${q}"` : ""} · 20초 갱신`;
  } catch (err) {
    boardStatus.textContent = err.message;
    gainersBody.innerHTML = `<tr><td colspan="10" class="empty">${escapeHtml(err.message)}</td></tr>`;
    moreGainers.hidden = true;
  }
}

function renderGainers() {
  const items = gainerItems.slice(0, gainerShown);
  if (!gainerItems.length) {
    gainersBody.innerHTML = `<tr><td colspan="10" class="empty">조건에 맞는 종목이 없습니다. 검색어나 필터를 바꿔 보세요.</td></tr>`;
    moreGainers.hidden = true;
    return;
  }
  gainersBody.innerHTML = items
    .map((row, i) => {
      const pct = row.changePct;
      const tone = pct == null ? "" : pct >= 0 ? "up" : "down";
      const pctTxt = pct == null ? "-" : `${pct >= 0 ? "+" : ""}${Number(pct).toFixed(2)}%`;
      const surge = row.volSurgePct;
      const surgeTone = surge == null ? "" : surge >= 0 ? "up" : "down";
      const surgeTxt = surge == null ? "-" : `${surge >= 0 ? "+" : ""}${Number(surge).toFixed(0)}%`;
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
        <td class="num ${tone}">${pctTxt}</td>
        <td class="num">${fmtAmt(row.volume)}</td>
        <td class="num ${surgeTone}">${surgeTxt}</td>
        <td class="num ${deltaTone}">${deltaTxt}</td>
        <td class="num">${fmtAmt(row.turnover)}</td>
        <td class="num"><span class="heat">${row.heat != null ? row.heat : "-"}</span></td>
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

function fmtAmt(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

loadGainers();
gainerTimer = setInterval(loadGainers, 20000);

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
      buyAlertSpent = false;
      buyAlertOpen = false;
      hideBuyAlert();
      lockedTrade = {
        sellAnchor: data.plan?.trade?.sellAnchor ?? data.plan?.trade?.sellPrice,
      };
    } else {
      lockedTrade = {
        ...lockedTrade,
        sellAnchor: lockedTrade?.sellAnchor ?? data.plan?.trade?.sellAnchor ?? data.plan?.trade?.sellPrice,
      };
    }
    render(data);
    handleBuySignal(data.plan, data.quote?.price ?? data.plan?.levels?.price);
    drawChart(data.candles || [], data.plan, { resetView });
    activeSymbol = nextSymbol;
    statusEl.textContent = `${fmtTime(data.asOf)} · 1분봉 2초 갱신`;
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
  return `${trade.buyLiveExecutable ? "지금 ASK에 매수" : "호가 대기"} ${fmtNum(liveBuy)} · 고정 ${fmtNum(trade.buyPrice)} · 손절 ${fmtNum(trade.stopPrice)} · ${new Date().toLocaleTimeString("ko-KR", { hour12: false })}`;
}

function showBuyAlert(trade, { pulse = false } = {}) {
  const box = document.getElementById("buy-alert");
  const detail = document.getElementById("buy-alert-detail");
  detail.textContent = buyAlertText(trade);
  box.hidden = false;
  if (pulse) {
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = "";
  }
  setLiveTickets(true);
  document.querySelector(".ticket.buy-live")?.classList.add("hot");
}

function hideBuyAlert() {
  const box = document.getElementById("buy-alert");
  if (box) box.hidden = true;
  setLiveTickets(false);
  document.querySelector(".ticket.buy-live")?.classList.remove("hot");
}

function setLiveTickets(on) {
  document.getElementById("tickets")?.classList.toggle("live-on", on);
  const buyLive = document.querySelector(".ticket.buy-live");
  const stopLive = document.querySelector(".ticket.stop-live");
  if (buyLive) buyLive.hidden = !on;
  if (stopLive) stopLive.hidden = !on;
}

function planPrice(plan, fallback) {
  const n = Number(fallback ?? plan?.levels?.price ?? plan?.trade?.buyLivePrice ?? plan?.trade?.buyPrice);
  return Number.isFinite(n) ? n : null;
}

function buyAlertShouldClose(px, entry) {
  if (px == null || entry == null || !(entry > 0)) return false;
  if (px <= entry * 0.9) return "down";
  if (px > entry) return "up";
  return false;
}

function handleBuySignal(plan, livePrice) {
  const trade = plan?.trade || {};
  const px = planPrice(plan, livePrice);
  const entry = Number(lockedTrade?.alertPrice ?? lockedTrade?.buyPrice);
  const shown = {
    ...trade,
    buyPrice: lockedTrade?.buyPrice ?? trade.buyPrice,
    buyReason: lockedTrade?.buyReason ?? trade.buyReason,
    stopPrice: lockedTrade?.stopPrice ?? trade.stopPrice,
    stopReason: lockedTrade?.stopReason ?? trade.stopReason,
  };

  if (buyAlertOpen) {
    if (buyAlertShouldClose(px, entry)) {
      hideBuyAlert();
      buyAlertOpen = false;
      buyArmed = false;
      lastBuySignal = true;
      return;
    }
    showBuyAlert(shown, { pulse: false });
    return;
  }

  if (buyAlertSpent || !isBuySignal(plan)) return;

  const alertPrice = trade.buyLivePrice ?? trade.buyPrice;
  lockedTrade = {
    ...lockedTrade,
    alertPrice,
    buyPrice: alertPrice,
    buyReason: `매수 타이밍 고정 ${fmtNum(alertPrice)}`,
    sellAnchor: trade.sellAnchor ?? trade.sellPrice,
    stopPrice: trade.stopPrice,
    stopReason: trade.stopReason || `매수 타이밍 손절 ${fmtNum(trade.stopPrice)}`,
  };
  shown.buyPrice = lockedTrade.buyPrice;
  shown.stopPrice = lockedTrade.stopPrice;
  buyAlertSpent = true;
  buyAlertOpen = true;
  buyArmed = true;
  lastBuySignal = true;
  showBuyAlert(shown, { pulse: true });
  renderTrade({ trade: shown });
}

function renderTrade(plan, { onlyTakeProfit = false } = {}) {
  const trade = plan.trade || {};
  const sell = trade.takeProfit ?? trade.sellPrice;
  const liveBuy = trade.buyLivePrice ?? trade.buyPrice;
  document.getElementById("buy-live-price").textContent = liveBuy != null ? fmtNum(liveBuy) : "없음";
  document.getElementById("buy-live-reason").textContent = trade.buyLiveReason
    || (trade.ask != null ? `ASK ${fmtNum(trade.ask)}` : "호가 대기");
  document.querySelector(".ticket.buy-live")?.classList.toggle("ready", Boolean(trade.buyLiveExecutable));
  document.querySelector(".ticket.buy-live")?.classList.toggle("blocked", trade.buyLiveExecutable === false);
  document.getElementById("sell-price").textContent = sell != null ? fmtNum(sell) : "없음";
  document.getElementById("sell-reason").textContent = trade.sellReason || trade.takeProfitReason || "";
  document.getElementById("stop-live-price").textContent = trade.stopLivePrice != null ? fmtNum(trade.stopLivePrice) : "없음";
  document.getElementById("stop-live-reason").textContent = trade.stopLiveReason || "";
  if (!onlyTakeProfit) {
    document.getElementById("buy-price").textContent = trade.buyPrice != null ? fmtNum(trade.buyPrice) : "없음";
    document.getElementById("buy-reason").textContent = trade.buyReason || "";
    document.getElementById("stop-price").textContent = trade.stopPrice != null ? fmtNum(trade.stopPrice) : "없음";
    document.getElementById("stop-reason").textContent = trade.stopReason || "";
  }
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
  "ATR": "최근 변동 폭(평균 진폭)입니다. 손절·익절 거리를 잡을 때 참고합니다. 값이 클수록 흔들림이 큽니다.",
  "1분 거래량": "지금 만들고 있는 1분봉에서 체결된 주식 수입니다. 프장에는 토스 1분 거래량을 씁니다.",
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
        hint: "2초 갱신",
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

function ensureChart() {
  if (chart) return;
  const el = document.getElementById("chart");
  chart = LightweightCharts.createChart(el, {
    layout: { background: { color: "#141a2e" }, textColor: "#9aa6c8" },
    grid: { vertLines: { color: "#2a3354" }, horzLines: { color: "#2a3354" } },
    rightPriceScale: { borderColor: "#2a3354" },
    timeScale: {
      borderColor: "#2a3354",
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time) => etClock(time),
    },
    localization: {
      timeFormatter: (time) => etClock(time),
    },
    autoSize: true,
  });
  new ResizeObserver(() => chart?.applyOptions({})).observe(el);
  candleSeries = chart.addCandlestickSeries({
    upColor: "#3ee0a2",
    downColor: "#ff6b7a",
    borderVisible: false,
    wickUpColor: "#3ee0a2",
    wickDownColor: "#ff6b7a",
  });
  vwapSeries = chart.addLineSeries({ color: "#6ea8ff", lineWidth: 2, priceLineVisible: false });
  emaSeries = chart.addLineSeries({ color: "#f5c15c", lineWidth: 1, priceLineVisible: false });
  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
  });
  chart.priceScale("").applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } });
  chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
    if (ignoreRangeEvent || !range) return;
    savedTimeRange = range;
    applyVolumeScale(range);
  });
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
  const host = document.getElementById("chart");
  if (!chart || !tip || !host || tip.dataset.bound) return;
  tip.dataset.bound = "1";
  chart.subscribeCrosshairMove((param) => {
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
    let left = param.point.x + 14;
    let top = param.point.y + 14;
    if (left + tw > host.clientWidth - pad) left = param.point.x - tw - 14;
    if (top + th > host.clientHeight - pad) top = param.point.y - th - 14;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  });
}

function applyVolumeScale(range) {
  if (!volumeSeries) return;
  const view = range || chart.timeScale().getVisibleRange();
  let max = 0;
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

function drawChart(candles, plan, { resetView = false } = {}) {
  ensureChart();
  const keepRange = !resetView && (savedTimeRange || chart.timeScale().getVisibleRange());
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
    let color = up ? "rgba(62,224,162,0.55)" : "rgba(255,107,122,0.55)";
    if (c.session === "pre") color = "rgba(245,193,92,0.75)";
    if (c.session === "post") color = "rgba(110,168,255,0.7)";
    if (c.session === "other") color = "rgba(154,166,200,0.22)";
    return { time: c.time, value: c.volume || 0, color };
  });
  lastBarsByTime = new Map(data.map((c) => [c.time, c]));
  volumeSeries.setData(lastVolPoints);
  applyLines(plan?.trade || {}, isBuySignal(plan));
  const span = data.length > 1 ? data.at(-1).time - data[0].time : 0;
  const last = data.at(-1);
  const autoKey = last ? `${last.session}-${Math.floor(last.time / 86400)}` : "";
  if (resetView) lastAutoFocus = "";
  const focus = sessionFocusRange(data);
  const shouldFocus = Boolean(focus) && (resetView || lastAutoFocus !== autoKey);
  if (shouldFocus) {
    lastAutoFocus = autoKey;
    chart.timeScale().setVisibleRange(focus);
    savedTimeRange = chart.timeScale().getVisibleRange();
  } else if (resetView || !keepRange || (lastChartSpan && Math.abs(span - lastChartSpan) > 6 * 3600)) {
    chart.timeScale().fitContent();
    savedTimeRange = chart.timeScale().getVisibleRange();
  } else {
    chart.timeScale().setVisibleRange(keepRange);
  }
  applyVolumeScale(savedTimeRange || chart.timeScale().getVisibleRange());
  lastChartSpan = span;
  ignoreRangeEvent = false;
}

function applyLines(trade, live = false) {
  if (!candleSeries._radarMap) candleSeries._radarMap = {};
  const specs = [
    { key: "buyLive", price: live ? (trade.buyLivePrice ?? trade.ask ?? trade.buyPrice) : null, color: "#7dffc4", title: "매수 ASK" },
    { key: "buy", price: trade.buyPrice, color: "#3ee0a2", title: "매수" },
    { key: "sell", price: trade.takeProfit ?? trade.sellPrice, color: "#6ea8ff", title: "매도/익절" },
    { key: "stopLive", price: live ? trade.stopLivePrice : null, color: "#f5a15c", title: "손절(실시간)" },
    { key: "stop", price: trade.stopPrice, color: "#ff6b7a", title: "손절" },
  ];
  for (const spec of specs) {
    const existing = candleSeries._radarMap[spec.key];
    if (spec.price == null) {
      if (existing) {
        try { candleSeries.removePriceLine(existing); } catch {}
        delete candleSeries._radarMap[spec.key];
      }
      continue;
    }
    if (existing) {
      existing.applyOptions({ price: spec.price });
    } else {
      candleSeries._radarMap[spec.key] = candleSeries.createPriceLine({
        price: spec.price,
        color: spec.color,
        lineWidth: 2,
        title: spec.title,
      });
    }
  }
}

function startPoll() {
  stopPoll();
  refreshChart();
  pollTimer = setInterval(refreshChart, 2000);
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
    if (lockedTrade?.sellAnchor != null) params.set("sell", String(lockedTrade.sellAnchor));
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
      handleBuySignal(data.plan, data.price ?? data.quote?.price);
      renderTrade(data.plan, { onlyTakeProfit: true });
      renderSession(data.plan.session);
      renderPlan(data.plan);
      if (data.candles?.length) drawChart(data.candles, data.plan, { resetView: false });
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
  return Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 4 });
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
window.addEventListener("resize", () => chart?.applyOptions({}));

const preset = new URLSearchParams(location.search).get("q");
if (preset) {
  input.value = preset;
  runScan(preset);
}
