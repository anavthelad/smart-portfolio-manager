// ===== DATA STRUCTURE =====
// Portfolio stored as an ARRAY (DS concept)
let portfolio = JSON.parse(localStorage.getItem("portfolio")) || [];

// ===== DOM ELEMENTS =====
const totalInvestedEl = document.getElementById("totalInvested");
const currentValueEl = document.getElementById("currentValue");
const profitLossEl = document.getElementById("profitLoss");
const plPercentEl = document.getElementById("plPercent");
const riskScoreEl = document.getElementById("riskScore");
const tableBody = document.getElementById("portfolioTable");

// ===== ADD ASSET =====
function addAsset() {
  const symbol = document.getElementById("symbol").value.trim();
  const qty = Number(document.getElementById("qty").value);
  const buyPrice = Number(document.getElementById("buyPrice").value);
  const risk = document.getElementById("riskCategory").value;

  if (!symbol || qty <= 0 || buyPrice <= 0) {
    alert("Enter valid asset details");
    return;
  }

  const asset = {
    symbol,
    qty,
    buyPrice,
    currentPrice: buyPrice, // mock price
    risk
  };

  portfolio.push(asset);
  localStorage.setItem("portfolio", JSON.stringify(portfolio));

  renderPortfolio();
}
function renderPortfolio() {
  tableBody.innerHTML = "";

  let totalInvested = 0;
  let currentValue = 0;

  portfolio.forEach(asset => {
    const invested = asset.qty * asset.buyPrice;
    const current = asset.qty * asset.currentPrice;

    totalInvested += invested;
    currentValue += current;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${asset.symbol}</td>
      <td>${asset.qty}</td>
      <td>₹${asset.buyPrice}</td>
      <td>₹${asset.currentPrice}</td>
      <td>₹${current}</td>
      <td>₹${current - invested}</td>
      <td>${asset.risk}</td>
    `;
    tableBody.appendChild(row);
  });

  const profitLoss = currentValue - totalInvested;
  const plPercent = totalInvested ? ((profitLoss / totalInvested) * 100).toFixed(2) : 0;

  totalInvestedEl.innerText = `₹${totalInvested}`;
  currentValueEl.innerText = `₹${currentValue}`;
  profitLossEl.innerText = `₹${profitLoss}`;
  plPercentEl.innerText = `${plPercent}%`;
  riskScoreEl.innerText = `${portfolio.length} / 3`;
}

// Load data on refresh
renderPortfolio();

// ================== CONFIG ==================
const FINNHUB_API_KEY = "d4ppd0pr01qjpnb0ph20d4ppd0pr01qjpnb0ph2g"; // optional live price key
const PRICE_REFRESH_MS = 60_000; // live refresh every 60s

// ================== STATE ==================
let portfolio = JSON.parse(localStorage.getItem("portfolio") || "[]");
let viewMode = localStorage.getItem("viewMode") || "table";
let allocationChart = null;

// Notifications
let alerts = JSON.parse(localStorage.getItem("alerts") || "[]");
let shownToastIds = new Set();

// AI advisor tone
let marketTone = "neutral"; // "bullish", "bearish", "neutral"

// ================== UTILITIES ==================
function showLoader() {
  const loader = document.getElementById("loader");
  if (!loader) return;
  loader.style.opacity = 1;
  loader.textContent = "📊 Updating...";
  setTimeout(() => (loader.style.opacity = 0.5), 500);
}

function savePortfolio() {
  localStorage.setItem("portfolio", JSON.stringify(portfolio));
}

function saveAlerts() {
  localStorage.setItem("alerts", JSON.stringify(alerts));
}

async function fetchPrice(symbol) {
  if (!symbol || !FINNHUB_API_KEY) return 0;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
        symbol
      )}&token=${FINNHUB_API_KEY}`
    );
    const data = await res.json();
    return Number(data.c) || 0;
  } catch (err) {
    console.error("ERROR fetching price:", symbol, err);
    return 0;
  }
}

// ================== RISK ENGINE ==================
function isCryptoSymbol(symbol = "") {
  return /BTC|ETH|DOGE|SOL|USDT|SHIB|CRYPTO/i.test(symbol);
}

function baseRiskFromInput(risk = "") {
  if (/low/i.test(risk)) return 3;
  if (/high/i.test(risk)) return 8;
  return 6; // medium default
}

function computeAssetRiskScore(asset, totalValue) {
  const value = asset.qty * asset.currentPrice;
  const weight = totalValue ? (value / totalValue) * 10 : 0;

  let volatility = isCryptoSymbol(asset.symbol)
    ? 9
    : asset.buyPrice < 200
    ? 7
    : 4;
  const riskBase = baseRiskFromInput(asset.risk);
  const protection = asset.stopLoss ? 2 : 0;

  const score = Math.min(
    Math.max(
      0,
      0.35 * volatility + 0.25 * riskBase + 0.3 * weight - 0.1 * protection
    ),
    10
  );

  asset._riskScore = score;
  return score;
}

function computePortfolioRisk(portfolio, totalValue) {
  if (!portfolio.length || totalValue <= 0) {
    return {
      overallScore: 0,
      highRiskPct: 0,
      message: "Add assets to see portfolio risk.",
      label: "No Data",
    };
  }

  let weightedRisk = 0;
  let highRiskValue = 0;

  portfolio.forEach((asset) => {
    const value = asset.qty * asset.currentPrice;
    const weight = value / totalValue;
    const score = computeAssetRiskScore(asset, totalValue);

    weightedRisk += score * weight;
    if (score >= 7.5) highRiskValue += value;
  });

  const highRiskPct = (highRiskValue / totalValue) * 100;

  let label = "Low";
  let message = "Safe and stable allocation.";
  if (weightedRisk >= 3.5 && weightedRisk < 7) {
    label = "Moderate";
    message = "Balanced risk profile.";
  } else if (weightedRisk >= 7) {
    label = "High";
    message = "⚠ Risky exposure — consider rebalancing.";
  }

  return {
    overallScore: weightedRisk,
    highRiskPct,
    message,
    label,
  };
}

// ================== ALERT ENGINE ==================
function createAlert(type, asset) {
  const now = Date.now();
  const alertObj = {
    id: `${asset.symbol}_${type}_${now}`,
    type,
    symbol: asset.symbol,
    message:
      type === "SL"
        ? `Stop-loss hit: ${asset.symbol} → ₹${asset.currentPrice}`
        : `Take-profit triggered: ${asset.symbol} → ₹${asset.currentPrice}`,
    ts: new Date(now).toLocaleString(),
    read: false,
  };

  alerts.unshift(alertObj);
  saveAlerts();
  renderNotifications();
  showToast(alertObj);
}

function checkAssetAlerts(asset) {
  if (!asset) return;

  if (
    asset.stopLoss != null &&
    !asset.slTriggered &&
    asset.currentPrice <= asset.stopLoss
  ) {
    asset.slTriggered = true;
    createAlert("SL", asset);
  }

  if (
    asset.takeProfit != null &&
    !asset.tpTriggered &&
    asset.currentPrice >= asset.takeProfit
  ) {
    asset.tpTriggered = true;
    createAlert("TP", asset);
  }
}

// ================== TOAST UI ==================
function ensureToastContainer() {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

function showToast(alertObj) {
  if (shownToastIds.has(alertObj.id)) return;
  shownToastIds.add(alertObj.id);

  const container = ensureToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast ${
    alertObj.type === "SL" ? "toast-danger" : "toast-success"
  }`;
  toast.innerHTML = `
    <strong>${
      alertObj.type === "SL" ? "🚨 Stop Loss" : "🎯 Take Profit"
    }</strong>
    <div>${alertObj.message}</div>
    <small>${alertObj.ts}</small>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function markAllAlertsRead() {
  alerts.forEach((a) => (a.read = true));
  saveAlerts();
  renderNotifications();
}

// ================== CRUD ==================
async function addAsset() {
  const symbol = document.getElementById("symbol").value.toUpperCase();
  const qty = Number(document.getElementById("qty").value);
  const buyPrice = Number(document.getElementById("buyPrice").value);
  const stopLossRaw = document.getElementById("stopLoss").value;
  const takeProfitRaw = document.getElementById("takeProfit").value;
  const risk = document.getElementById("riskCategory").value;

  const stopLoss = stopLossRaw ? Number(stopLossRaw) : null;
  const takeProfit = takeProfitRaw ? Number(takeProfitRaw) : null;

  if (!symbol || !qty || !buyPrice)
    return alert("Fill required fields: Symbol, Qty, Buy Price.");

  showLoader();

  let currentPrice = await fetchPrice(symbol);
  if (!currentPrice) currentPrice = buyPrice;

  portfolio.push({
    symbol,
    qty,
    buyPrice,
    currentPrice,
    risk,
    stopLoss,
    takeProfit,
    slTriggered: false,
    tpTriggered: false,
  });

  savePortfolio();
  updateUI();
  renderNotifications();
  refreshPricesOnce(); // refresh engine immediately
}

function deleteAsset(symbol) {
  if (confirm(`Delete ${symbol}?`)) {
    portfolio = portfolio.filter((a) => a.symbol !== symbol);
    savePortfolio();
    updateUI();
  }
}

// ================== UI RENDER ==================
function updateUI() {
  const tbody = document.getElementById("portfolioTable");
  const cardContainer = document.getElementById("portfolioView");
  const tableView = document.getElementById("tableView");

  if (!tbody || !cardContainer) return;

  tbody.innerHTML = "";
  cardContainer.innerHTML = "";

  let totalInvested = 0;
  let totalValue = 0;

  portfolio.forEach((a) => {
    const cost = a.qty * a.buyPrice;
    const val = a.qty * a.currentPrice;
    totalInvested += cost;
    totalValue += val;

    const plPct = cost ? (((val - cost) / cost) * 100).toFixed(2) : "0.00";

    tbody.innerHTML += `
      <tr>
        <td onclick="loadChart('${a.symbol}')">${a.symbol}</td>
        <td>${a.qty}</td>
        <td>₹${a.buyPrice}</td>
        <td>
  ₹${a.currentPrice.toFixed(2)}
  <span style="color:${a.currentPrice > a.buyPrice ? '#4caf50' : '#ff4c4c'}; font-weight:600;">
    ${a.currentPrice > a.buyPrice ? "🔼" : "🔻"}
    ₹${(a.currentPrice - a.buyPrice).toFixed(2)} 
    (${(((a.currentPrice - a.buyPrice) / a.buyPrice) * 100).toFixed(2)}%)
  </span>
</td>

        <td>₹${val.toFixed(2)}</td>
        <td>${plPct}%</td>
        <td>${a.risk}</td>
        <td>${a.stopLoss || "-"} / ${a.takeProfit || "-"}</td>
        <td><button class="delete-btn" onclick="deleteAsset('${
          a.symbol
        }')">Delete</button></td>
      </tr>`;

    cardContainer.innerHTML += `
      <div class="asset-card">
        <strong onclick="loadChart('${a.symbol}')">${a.symbol}</strong>
        <div>Qty: ${a.qty}</div>
        <div>Buy: ₹${a.buyPrice}</div>
        <div>
  Current: ₹${a.currentPrice.toFixed(2)}
  <span style="color:${a.currentPrice > a.buyPrice ? '#4caf50' : '#ff4c4c'}; font-weight:600;">
    ${a.currentPrice > a.buyPrice ? "🔼" : "🔻"}
    ₹${(a.currentPrice - a.buyPrice).toFixed(2)} 
    (${(((a.currentPrice - a.buyPrice) / a.buyPrice) * 100).toFixed(2)}%)
  </span>
</div>

        <div>Value: ₹${val.toFixed(2)}</div>
        <div>P/L: ${plPct}%</div>
        <div>Risk: ${a.risk}</div>
      </div>`;
  });

  // metrics update
  const totalInvestedEl = document.getElementById("totalInvested");
  const currentValueEl = document.getElementById("currentValue");
  const profitLossEl = document.getElementById("profitLoss");
  const plPercentEl = document.getElementById("plPercent");

  const profit = totalValue - totalInvested;
  const plTotalPct = totalInvested
    ? (((totalValue - totalInvested) / totalInvested) * 100).toFixed(2)
    : "0.00";

  if (totalInvestedEl)
    totalInvestedEl.textContent = `₹${totalInvested.toFixed(2)}`;
  if (currentValueEl)
    currentValueEl.textContent = `₹${totalValue.toFixed(2)}`;
  if (profitLossEl) profitLossEl.textContent = `₹${profit.toFixed(2)}`;
  if (plPercentEl) plPercentEl.textContent = `${plTotalPct}%`;

  // risk UI
 const risk = computePortfolioRisk(portfolio, totalValue);

document.getElementById("highRisk").textContent = `${risk.highRiskPct.toFixed(1)}%`;

// ---- FIXED: Show correct label and score ----
const overallRiskText = document.getElementById("riskMeterLabel");
overallRiskText.textContent = 
  risk.label === "No Data"
  ? "Add assets to see risk level"
  : `Overall Risk: ${risk.label} (${risk.overallScore.toFixed(1)}/10)`;

// Risk score mapping (1–3 scale)
document.getElementById("riskScore").textContent =
  risk.overallScore < 4 ? "1 / 3" :
  risk.overallScore < 7 ? "2 / 3" : "3 / 3";

// ---- Color + meter animation ----
const meter = document.getElementById("riskMeterFill");
meter.style.width = (risk.overallScore * 10) + "%";

meter.classList.remove("low","moderate","high");
if (risk.overallScore < 4) meter.classList.add("low");
else if (risk.overallScore < 7) meter.classList.add("moderate");
else meter.classList.add("high");

// ---- Text description below ----
const alertBox = document.getElementById("riskAlert");
alertBox.textContent = risk.message;

  // table/card view toggle state
  if (viewMode === "table") {
    if (tableView) tableView.style.display = "block";
    cardContainer.style.display = "none";
  } else {
    if (tableView) tableView.style.display = "none";
    cardContainer.style.display = "grid";
  }

  updateAllocationChart();
  injectRebalanceBox();
  calculateRebalanceRecommendations();
  injectAIAdvisorBox();
  updateAIAdvisor();
}

// ================== ALLOCATION CHART ==================
function updateAllocationChart() {
  const data = portfolio.length
    ? portfolio.map((a) => [a.symbol, a.qty * a.currentPrice])
    : [["No Assets", 1]];

  if (!allocationChart)
     {
    allocationChart = Highcharts.chart("allocationChart3D", {
      chart: {
        type: "pie",
        options3d: { enabled: true, alpha: 55 },
        backgroundColor: "transparent",
      },
      title: { text: "" },
      plotOptions: {
        pie: {
          depth: 45,
          dataLabels: { enabled: false },
        },
      },
      series: [{ data }],
    });
  } else {
    allocationChart.series[0].setData(data, true);
  }
  Highcharts.setOptions({
  chart: {
    backgroundColor: "transparent",
    style: {
      fontFamily: "Inter, system-ui, sans-serif"
    }
  },

  title: {
    style: {
      color: "#e5e7eb",
      fontSize: "16px",
      fontWeight: "600"
    }
  },

  subtitle: {
    style: {
      color: "#9ca3af"
    }
  },

  legend: {
    itemStyle: {
      color: "#e5e7eb"
    },
    itemHoverStyle: {
      color: "#60a5fa"
    }
  },

  tooltip: {
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderColor: "rgba(255,255,255,0.08)",
    style: {
      color: "#f9fafb"
    }
  },

  plotOptions: {
    pie: {
      borderWidth: 0,
      shadow: false,
      dataLabels: {
        enabled: true,
        color: "#e5e7eb",
        style: {
          textOutline: "none",
          fontSize: "12px"
        }
      }
    }
  },

  colors: [
    "#38bdf8", // blue
    "#22c55e", // green
    "#8b5cf6", // violet
    "#f59e0b", // amber
    "#ef4444"  // red
  ]
});
}

// ================== TRADINGVIEW ==================
function loadChart(symbol) {
  const container = document.getElementById("chartContainer");
  container.innerHTML = "";

  new TradingView.widget({
    container_id: "chartContainer",
    autosize: true,
    symbol,
    interval: "D",
    theme: "dark",
    style: "1",
    locale: "en",
    toolbar_bg: "rgba(0, 0, 0, 0)",
    hide_side_toolbar: false,
  });
  
}

// ================== LIVE REFRESH ==================
async function refreshPricesOnce() {
  if (!FINNHUB_API_KEY) {
    // even without API, still update derived UI
    updateUI();
    return;
  }

  if (!portfolio.length) {
    updateUI();
    return;
  }

  showLoader();

  for (let asset of portfolio) {
    const price = await fetchPrice(asset.symbol);
    if (price) {
      asset.currentPrice = price;
      checkAssetAlerts(asset);
    }
  }

  savePortfolio();
  updateUI();
}

function startPriceRefresh() {
  refreshPricesOnce();
  setInterval(refreshPricesOnce, PRICE_REFRESH_MS);
}

// ================== AUTO REBALANCE ENGINE ==================
const TARGET_WEIGHTS = {
  equity: 0.5,
  crypto: 0.3,
  other: 0.2,
};

function classifyAssetForRebalance(symbol) {
  if (/BTC|ETH|DOGE|SOL|USDT|SHIB|CRYPTO/i.test(symbol)) return "crypto";
  if (/GOLD|SILVER|XAU|XAG|WTI|OIL/i.test(symbol)) return "other";
  return "equity";
}

function injectRebalanceBox() {
  if (!document.getElementById("rebalanceBox")) {
    const div = document.createElement("div");
    div.id = "rebalanceBox";
    div.style.marginTop = "15px";
    div.style.padding = "14px";
    div.style.borderRadius = "10px";
    div.style.background = "rgba(255,255,255,0.07)";
    div.style.backdropFilter = "blur(4px)";
    div.style.fontSize = "14px";
    div.style.lineHeight = "1.35";
    div.style.border = "1px solid rgba(255,255,255,0.1)";
    div.innerHTML = "📊 Loading recommendations…";

    const riskCard = document.querySelector(
      ".card:nth-of-type(2) .stats-grid"
    );
    if (riskCard && riskCard.parentNode) {
      riskCard.parentNode.appendChild(div);
    }
  }
}

function updateRebalanceUI(textHtml) {
  const box = document.getElementById("rebalanceBox");
  if (!box) return;
  box.innerHTML = textHtml;
}

function calculateRebalanceRecommendations() {
  const box = document.getElementById("rebalanceBox");
  if (!box) return;

  if (!portfolio.length) {
    updateRebalanceUI("Add assets to get allocation suggestions.");
    return;
  }

  const totalValue = portfolio.reduce(
    (sum, a) => sum + a.qty * a.currentPrice,
    0
  );
  const allocation = { equity: 0, crypto: 0, other: 0 };

  portfolio.forEach((a) => {
    const type = classifyAssetForRebalance(a.symbol);
    allocation[type] += a.qty * a.currentPrice;
  });

  let html = `<strong style="font-size:15px;">📌 Rebalancing Suggestions</strong><br><br>`;

  Object.entries(allocation).forEach(([cat, value]) => {
    const currentPct = totalValue ? (value / totalValue) * 100 : 0;
    const targetPct = (TARGET_WEIGHTS[cat] || 0) * 100;
    const diff = currentPct - targetPct;

    if (diff > 5) {
      html += `⚠ <strong>${cat.toUpperCase()}</strong> overweight by <b>+${diff.toFixed(
        1
      )}%</b> — consider trimming.<br>`;
    } else if (diff < -5) {
      html += `📈 <strong>${cat.toUpperCase()}</strong> underweight by <b>${Math.abs(
        diff
      ).toFixed(1)}%</b> — consider adding.<br>`;
    } else {
      html += `✅ <strong>${cat.toUpperCase()}</strong> roughly on target.<br>`;
    }
  });

  updateRebalanceUI(html);
}

// ================== AI REBALANCE ADVISOR ==================
function generateAISummary(portfolioRisk, rebalanceText, allocation) {
  const { overallScore, message } = portfolioRisk;

  let toneTxt = "";
  switch (marketTone) {
    case "bullish":
      toneTxt =
        "📈 Market tone: Bullish — tilting toward growth assets can be considered, while controlling downside.";
      break;
    case "bearish":
      toneTxt =
        "⚠️ Market tone: Bearish — focus on capital protection and trimming excess risk.";
      break;
    default:
      toneTxt =
        "📊 Market tone: Neutral — maintaining a balanced structure is reasonable unless you have strong conviction.";
  }

  let riskTxt = `Risk Level: <b>${overallScore.toFixed(
    1
  )}/10</b> — ${message}`;

  let allocTxt = "";
  Object.entries(allocation).forEach(([cat, val]) => {
    allocTxt += `• <b>${cat.toUpperCase()}</b> → ₹${val.toFixed(2)}<br>`;
  });

  return `
${toneTxt}<br><br>
${riskTxt}<br><br>
💡 Allocation Snapshot:<br>
${allocTxt}<br>
🎯 Recommended Adjustments:<br>
${rebalanceText}
`;
}

function generateTradeActions() {
  if (!portfolio.length)
    return "Add some assets to receive tactical suggestions.";

  let actions = "";
  portfolio.forEach((asset) => {
    const move =
      asset._riskScore >= 7.5
        ? "Reduce exposure slightly — risk score elevated."
        : asset._riskScore <= 3
        ? "Consider increasing allocation — very conservative."
        : "Hold and monitor — risk is balanced.";
    actions += `- <b>${asset.symbol}</b> → ${move}<br>`;
  });
  return actions;
}

function injectAIAdvisorBox() {
  if (!document.getElementById("aiAdvisorBox")) {
    const box = document.createElement("div");
    box.id = "aiAdvisorBox";
    box.style.marginTop = "20px";
    box.style.padding = "18px";
    box.style.border = "1px solid rgba(255,255,255,0.12)";
    box.style.background = "rgba(15,23,42,0.85)";
    box.style.borderRadius = "12px";
    box.style.fontSize = "14px";
    box.style.lineHeight = "1.45";

    box.innerHTML = "🤖 AI Advisor Loading…";

    // place before portfolio card if possible
    const portfolioCard = document.querySelector(".portfolio-card");
    if (portfolioCard && portfolioCard.parentNode) {
      portfolioCard.parentNode.insertBefore(box, portfolioCard);
    }
  }
}

function updateAIAdvisor() {
  const box = document.getElementById("aiAdvisorBox");
  if (!box) return;

  if (!portfolio.length) {
    box.innerHTML = "📌 Add assets to activate AI guidance.";
    return;
  }

  const totalValue = portfolio.reduce(
    (sum, a) => sum + a.qty * a.currentPrice,
    0
  );
  const allocation = { equity: 0, crypto: 0, other: 0 };

  portfolio.forEach((a) => {
    const type = classifyAssetForRebalance(a.symbol);
    allocation[type] += a.qty * a.currentPrice;
  });

  const portfolioRisk = computePortfolioRisk(portfolio, totalValue);

  const rebalanceBox = document.getElementById("rebalanceBox");
  const rebalanceText = rebalanceBox
    ? rebalanceBox.innerHTML.replace(
        /<strong[^>]*>📌 Rebalancing Suggestions<\/strong><br><br>/,
        ""
      )
    : "";

  const aiSummary = generateAISummary(
    portfolioRisk,
    rebalanceText,
    allocation
  );
  const tradeGuide = generateTradeActions();

  box.innerHTML = `
    <div style="font-size:15px; font-weight:600; margin-bottom:6px;">🤖 AI Portfolio Advisor</div>
    ${aiSummary}
    <br>
    <div style="margin-top:6px;">
      <b>📍 Trade Execution Guide:</b><br>
      ${tradeGuide}
    </div>
  `;
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  // Notification center wiring
  const notifBtn = document.getElementById("notifBtn");
  const clearBtn = document.getElementById("clearNotifBtn");
  if (notifBtn) {
    notifBtn.addEventListener("click", () => {
      const panel = document.getElementById("notifPanel");
      if (panel) panel.classList.toggle("open");
      markAllAlertsRead();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      alerts = [];
      saveAlerts();
      renderNotifications();
    });
  }

  injectRebalanceBox();
  injectAIAdvisorBox();
  updateUI();
  renderNotifications();
  startPriceRefresh();
});

// expose
window.addAsset = addAsset;
window.deleteAsset = deleteAsset;
window.loadChart = loadChart;
window.addEventListener("resize", () => {
  const symbol = document.querySelector("#chartContainer iframe")
    ? document.querySelector(".asset-card strong")?.innerText
    : null;

  if (symbol) loadChart(symbol);
});
function updateChartPLDisplay(symbol) {
  const boxSymbol = document.getElementById("chartSymbol");
  const boxPL = document.getElementById("chartPL");

  const asset = portfolio.find(a => a.symbol === symbol);
  if (!asset) return;

  const diff = asset.currentPrice - asset.buyPrice;
  const percent = ((diff / asset.buyPrice) * 100).toFixed(2);
  const isProfit = diff > 0;

  boxSymbol.textContent = `📈 ${symbol}`;
  boxPL.textContent = `${isProfit ? "🔼" : "🔻"} ₹${diff.toFixed(2)} (${percent}%)`;

  boxPL.style.color = isProfit ? "#4caf50" : diff < 0 ? "#ff4c4c" : "#bbb";
}
function toggleProfileMenu() {
    document.getElementById("profilePopup").classList.toggle("show");
}

document.addEventListener("click", (e) => {
    const popup = document.getElementById("profilePopup");
    const button = document.querySelector(".sidebar-profile");

    if (!button.contains(e.target) && !popup.contains(e.target)) {
        popup.classList.remove("show");
    }
});
function toggleSidebar() {
    const sidebar = document.querySelector(".sidebar");
    sidebar.classList.toggle("collapsed");

    // Close profile dropdown when collapsing
    if (sidebar.classList.contains("collapsed")) {
        document.getElementById("profilePopup").classList.remove("show");
    }
}
