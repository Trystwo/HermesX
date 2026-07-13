/**
 * HermesX 实时仪表盘 — 浏览器端逻辑
 * Chart.js 渲染 + WebSocket 接收实时数据 + 回测功能
 */

const $ = (id) => document.getElementById(id);

// ---- DOM 引用 ----
const statusDot = $('status-indicator');
const statusText = $('status-text');

// ---- 模式管理 ----
let mode = 'live'; // 'live' | 'backtest'

function switchMode(newMode) {
  mode = newMode;
  // 更新按钮状态
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.mode-btn[data-mode="' + newMode + '"]')?.classList.add('active');
  // 切换面板
  $('live-panels').classList.toggle('hidden', mode !== 'live');
  $('backtest-panels').classList.toggle('hidden', mode !== 'backtest');
  // 通知服务端
  fetch('/api/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  }).catch(() => {});
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === mode) return;
    switchMode(btn.dataset.mode);
  });
});

// ---- 回测配置（滑块值同步） ----
function bindSlider(inputId, displayId, suffix, min, max, step) {
  const input = $(inputId);
  const display = $(displayId);
  if (!input || !display) return;
  const updateDisplay = () => { display.value = input.value + suffix; };
  input.addEventListener('input', updateDisplay);
  display.addEventListener('input', function() {
    var val = parseFloat(this.value);
    if (!isNaN(val)) {
      if (min !== undefined) val = Math.max(min, val);
      if (max !== undefined) val = Math.min(max, val);
      input.value = val;
      updateDisplay();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  display.addEventListener('blur', updateDisplay);
  updateDisplay();
}
bindSlider('bt-days', 'bt-days-val', '');
bindSlider('bt-stop', 'bt-stop-val', '%');
bindSlider('bt-tp', 'bt-tp-val', '%');
bindSlider('bt-amount', 'bt-amount-val', '');
bindSlider('bt-leverage', 'bt-leverage-val', 'x');
bindSlider('bt-initial-balance', 'bt-initial-balance-val', '');

// ---- v2 多空双开步骤回测 ----
let btState = null;
let btChart = null;

// 格式化价格
function fmtPrice(v) {
  if (v >= 1000) return '$' + v.toLocaleString('en-US', {minFractionDigits:2,maxFractionDigits:2});
  return '$' + v.toFixed(2);
}
function fmtUsd(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }

// 渲染仓位列表
function renderLots(containerId, lots, currentPrice, side) {
  const el = $(containerId);
  if (!lots || lots.length === 0) {
    el.innerHTML = '<p class="empty-hint">暂无</p>';
    return;
  }
  el.innerHTML = '<div style="display:grid;grid-template-columns:60px 80px 60px 70px;gap:4px;font-size:11px;color:#888;border-bottom:1px solid var(--card-border);padding-bottom:4px;margin-bottom:4px">' +
    '<span>#</span><span>开仓价</span><span>数量</span><span>浮动盈亏</span></div>' +
    lots.map((lot, i) => {
      const pnl = side === 'long'
        ? (currentPrice - lot.entryPrice) * lot.quantity
        : (lot.entryPrice - currentPrice) * lot.quantity;
      const color = pnl >= 0 ? '#22c55e' : '#ef4444';
      return `<div style="display:grid;grid-template-columns:60px 80px 60px 70px;gap:4px;font-size:11px;align-items:center">
        <span style="color:#888">#${i + 1}</span>
        <span>${fmtPrice(lot.entryPrice)}</span>
        <span style="color:#aaa">${lot.quantity.toFixed(6)}</span>
        <span style="color:${color}">${fmtUsd(pnl)}</span>
      </div>`;
    }).join('');
}

// 更新收益曲线图
function updateChart(snapshots, initialBalance) {
  if (!snapshots || snapshots.length < 2) return;
  const labels = snapshots.map(s => { const d = new Date(s.timestamp); return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`; });
  const equityData = snapshots.map(s => s.equity);
  const longPnlData = snapshots.map(s => s.longPnL);
  const shortPnlData = snapshots.map(s => s.shortPnL);
  const baseline = snapshots.map(() => initialBalance);

  const ctx = document.getElementById('bt-chart').getContext('2d');

  if (btChart) {
    // 如果数据集数量不匹配，重建图表
    if (btChart.data.datasets.length < 2) {
      btChart.destroy();
      btChart = null;
    } else {
      btChart.data.labels = labels;
      btChart.data.datasets[0].data = equityData;
      btChart.data.datasets[1].data = baseline;
      btChart.update('none');
    }
  }
  if (!btChart) {
    btChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '权益曲线', data: equityData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.2, pointRadius: 0 },
          { label: '初始资金', data: baseline, borderColor: '#888', borderDash: [4,4], backgroundColor: 'transparent', tension: 0, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 20, font: { size: 10 } } },
          y: {
            ticks: { font: { size: 10 }, callback: v => '$' + v.toFixed(0) },
          },
        },
      },
    });
  }
}

// 渲染回测当前状态
function renderBtState() {
  if (!btState) return;
  const s = btState;
  const total = s.candles.length;
  const idx = s.currentIndex;
  const price = idx > 0 ? s.candles[idx - 1].open : (s.snapshots.length > 0 ? s.snapshots[s.snapshots.length - 1].openPrice : 0);
  let totalMargin = 0;
  let unrealizedPnL = 0;
  if (idx > 0) {
    const lastCandle = s.candles[idx - 1];
    const cp = lastCandle.open;
    for (const lot of s.longLots) {
      totalMargin += lot.margin;
      unrealizedPnL += (cp - lot.entryPrice) * lot.quantity;
    }
    for (const lot of s.shortLots) {
      totalMargin += lot.margin;
      unrealizedPnL += (lot.entryPrice - cp) * lot.quantity;
    }
  }
  const totalEquity = s.balance + totalMargin + unrealizedPnL;
  const totalPnl = totalEquity - s.initialBalance;
  const returnPct = s.initialBalance > 0 ? (totalPnl / s.initialBalance * 100) : 0;

  // 汇总
  $('bt-progress-text').textContent = `${idx} / ${total}`;
  $('bt-equity').textContent = fmtPrice(totalEquity);
  $('bt-pnl').textContent = fmtUsd(totalPnl);
  $('bt-pnl').className = 'value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  $('bt-return').textContent = (returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%';
  $('bt-return').className = 'value ' + (returnPct >= 0 ? 'positive' : 'negative');
  $('bt-lot-count').textContent = s.longLots.length + s.shortLots.length;
  $('bt-fee').textContent = '$' + (s.totalFee ?? 0).toFixed(2);
  $('bt-margin').textContent = fmtPrice(totalMargin);
  $('bt-total-open').textContent = s.totalOpenCount ?? 0;

  // 从快照统计止盈/止损单数
  let tpTotal = 0, slTotal = 0, tpAmount = 0, slAmount = 0;
  for (const snap of s.snapshots) {
    if (snap.stoppedLots) {
      for (const l of snap.stoppedLots) {
        if (l.reason === 'tp') { tpTotal++; tpAmount += l.pnl; }
        else { slTotal++; slAmount += l.pnl; }
      }
    }
  }
  $('bt-tp-count').textContent = tpTotal;
  $('bt-tp-amount').textContent = fmtUsd(tpAmount);
  $('bt-tp-amount').className = 'value positive';
  $('bt-sl-count').textContent = slTotal;
  $('bt-sl-amount').textContent = fmtUsd(slAmount);
  $('bt-sl-amount').className = 'value negative';

  // 图表
  updateChart(s.snapshots, s.initialBalance);

  // 多/空单PnL 表格
  const pnlTable = $('bt-pnl-table');
  if (s.snapshots.length > 0) {
    const last = s.snapshots[s.snapshots.length - 1];
    const longPnl = last.longPnL || 0;
    const shortPnl = last.shortPnL || 0;
    pnlTable.innerHTML = `<div style="padding:6px 8px;background:rgba(34,197,94,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">多单 PnL</div>
      <div style="color:${longPnl >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${longPnl >= 0 ? '+' : ''}$${longPnl.toFixed(2)}</div>
    </div>
    <div style="padding:6px 8px;background:rgba(239,68,68,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">空单 PnL</div>
      <div style="color:${shortPnl >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${shortPnl >= 0 ? '+' : ''}$${shortPnl.toFixed(2)}</div>
    </div>`;
  } else {
    pnlTable.innerHTML = '';
  }

  // 仓位
  const lastPrice = idx > 0 ? s.candles[idx - 1].open : (s.snapshots.length > 0 ? s.snapshots[s.snapshots.length - 1].openPrice : 0);
  renderLots('bt-long-list', s.longLots, lastPrice, 'long');
  renderLots('bt-short-list', s.shortLots, lastPrice, 'short');

  // 操作日志
  const logList = $('bt-log-list');
  if (s.snapshots.length > 0) {
    logList.innerHTML = s.snapshots.map(snap => {
      const d = new Date(snap.timestamp);
      const time = `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`;
      const stopInfo = snap.stoppedLots && snap.stoppedLots.length > 0
        ? ' | ' + snap.stoppedLots.map(l => `${l.reason === 'tp' ? '🎯止盈' : '⛔止损'} ${l.side}@${fmtPrice(l.closePrice)}(${fmtUsd(l.pnl)})`).join(' ')
        : '';
      return `<div class="log-line" style="font-size:11px">#${snap.hour} ${time} 价格${fmtPrice(snap.openPrice)} ${snap.action}${stopInfo}</div>`;
    }).join('');
    logList.scrollTop = logList.scrollHeight;
  }

  // 按钮状态
  $('bt-step-btn').disabled = s.done;
  $('bt-runall-btn').disabled = s.done;
  $('bt-init-btn').disabled = false;
}

// 初始化
$('bt-init-btn').addEventListener('click', async () => {
  const btn = $('bt-init-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 获取数据...';
  try {
    const res = await fetch('/api/backtest/v2/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: ($('bt-symbol').value || 'btcusdt').trim().toLowerCase(),
        days: Number($('bt-days').value),
        interval: $('bt-interval').value,
        stopLossPercent: Number($('bt-stop').value) / 100,
        takeProfitPercent: Number($('bt-tp').value) / 100,
        positionAmountValue: Number($('bt-amount').value),
        initialBalance: Number($('bt-initial-balance').value),
        leverage: Number($('bt-leverage').value),
        marginRatio: 0.8,
        direction: (document.querySelector('input[name="bt-direction"]:checked') || {}).value || 'both',
      }),
    });
    const data = await res.json();
    if (!data.success) { alert('初始化失败: ' + data.error); btn.disabled = false; btn.textContent = '📥 初始化'; return; }
    btState = data.state;
    // 清除历史图表，避免 chart 冲突
    if (btChart) { btChart.destroy(); btChart = null; }
    renderBtState();
    $('bt-step-btn').disabled = false;
    $('bt-runall-btn').disabled = false;
  } catch (err) { alert('请求失败: ' + err.message); }
  btn.disabled = false;
  btn.textContent = '📥 初始化';
});

// 下一步
$('bt-step-btn').addEventListener('click', async () => {
  if (!btState) return;
  $('bt-step-btn').disabled = true;
  try {
    const res = await fetch('/api/backtest/v2/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: btState }),
    });
    const data = await res.json();
    if (!data.success) { alert('步骤失败: ' + data.error); return; }
    btState = data.state;
    renderBtState();
  } catch (err) { alert('请求失败: ' + err.message); }
});

// 运行全部
$('bt-runall-btn').addEventListener('click', async () => {
  if (!btState) return;
  $('bt-runall-btn').disabled = true;
  $('bt-step-btn').disabled = true;
  try {
    const res = await fetch('/api/backtest/v2/runAll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: btState }),
    });
    const data = await res.json();
    if (!data.success) { alert('运行失败: ' + data.error); return; }
    btState = data.state;
    renderBtState();
    loadHistoryList();
  } catch (err) { alert('请求失败: ' + err.message); }
});

// ---- 实时模式状态变量 ----
let historyA = [];
let historyB = [];
let historyTotal = [];
let posHistory = [];
let startTime = 0;
let startTimeSet = false;
let lastPosHour = 0;

// ---- 实时 v2 引擎 ----
let liveState = null;
let liveRunning = false;

// 实时滑块绑定
bindSlider('live-stop', 'live-stop-val', '%');
bindSlider('live-tp', 'live-tp-val', '%');
bindSlider('live-amount', 'live-amount-val', '');
bindSlider('live-leverage', 'live-leverage-val', 'x');

/** 渲染实时 v2 引擎状态 */
function renderLiveState() {
  if (!liveState) return;
  const s = liveState;
  const initialBalance = s.config.initialBalance;
  const totalEquity = s.balance + (s.snapshots.length > 0 ? s.snapshots[s.snapshots.length - 1].unrealizedPnL : 0);
  const totalPnl = totalEquity - initialBalance;
  const returnPct = initialBalance > 0 ? (totalPnl / initialBalance * 100) : 0;
  const lastPrice = s.lastPrice;

  // 模式标签
  const badge = $('live-mode-badge');
  if (badge) {
    if (s.config.mode === 'real') { badge.textContent = '🔴 实盘交易'; badge.style.background = 'rgba(239,68,68,0.1)'; badge.style.color = '#ef4444'; }
    else if (s.running && s.config.mode === 'sim') { badge.textContent = '🟡 币安测试网'; badge.style.background = 'rgba(234,179,8,0.1)'; badge.style.color = '#eab308'; }
    else { badge.textContent = '🟢 本地模拟'; badge.style.background = 'rgba(34,197,94,0.1)'; badge.style.color = '#22c55e'; }
  }

  // 汇总
  $('bt-progress-text').textContent = s.running ? '🟢 运行中' : '⏹️ 已停止';
  $('bt-equity').textContent = fmtPrice(totalEquity);
  $('bt-pnl').textContent = fmtUsd(totalPnl);
  $('bt-pnl').className = 'value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  $('bt-return').textContent = (returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%';
  $('bt-return').className = 'value ' + (returnPct >= 0 ? 'positive' : 'negative');
  $('bt-lot-count').textContent = s.longLots.length + s.shortLots.length;
  $('bt-fee').textContent = '$' + (s.totalFee ?? 0).toFixed(2);
  $('bt-margin').textContent = fmtPrice(s.longLots.reduce((a,l)=>a+l.margin,0) + s.shortLots.reduce((a,l)=>a+l.margin,0));
  $('bt-total-open').textContent = s.totalOpenCount ?? 0;

  // 止损/止盈统计
  let tpTotal = 0, slTotal = 0, tpAmt = 0, slAmt = 0;
  for (const snap of s.snapshots) {
    if (snap.stoppedLots) {
      for (const l of snap.stoppedLots) {
        if (l.reason === 'tp') { tpTotal++; tpAmt += l.pnl; }
        else { slTotal++; slAmt += l.pnl; }
      }
    }
  }
  $('bt-tp-count').textContent = tpTotal;
  $('bt-tp-amount').textContent = fmtUsd(tpAmt);
  $('bt-tp-amount').className = 'value positive';
  $('bt-sl-count').textContent = slTotal;
  $('bt-sl-amount').textContent = fmtUsd(slAmt);
  $('bt-sl-amount').className = 'value negative';

  // 图表
  if (s.snapshots.length >= 2) {
    updateChart(s.snapshots, initialBalance);
  }

  // PnL 表格
  const pnlTable = $('bt-pnl-table');
  if (s.snapshots.length > 0) {
    const last = s.snapshots[s.snapshots.length - 1];
    pnlTable.innerHTML = `<div style="padding:6px 8px;background:rgba(34,197,94,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">多单 PnL</div>
      <div style="color:${last.longPnL >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${last.longPnL >= 0 ? '+' : ''}$${last.longPnL.toFixed(2)}</div>
    </div>
    <div style="padding:6px 8px;background:rgba(239,68,68,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">空单 PnL</div>
      <div style="color:${last.shortPnL >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${last.shortPnL >= 0 ? '+' : ''}$${last.shortPnL.toFixed(2)}</div>
    </div>`;
  }

  // 仓位
  if (lastPrice > 0) {
    renderLots('bt-long-list', s.longLots, lastPrice, 'long');
    renderLots('bt-short-list', s.shortLots, lastPrice, 'short');
  }

  // 日志
  if (s.logEntries && s.logEntries.length > 0) {
    const logList = $('bt-log-list');
    logList.innerHTML = s.logEntries.map(msg => `<div>${msg}</div>`).join('');
    logList.scrollTop = logList.scrollHeight;
  }
}

/** 锁定/解锁实时配置 */
function setLiveConfigLocked(locked) {
  ['live-stop','live-tp','live-amount','live-leverage','live-interval','live-symbol'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  // 方向单选
  document.querySelectorAll('input[name="live-direction"]').forEach(function(r) { r.disabled = locked; });
  // 模式单选
  document.querySelectorAll('input[name="live-mode"]').forEach(function(r) { r.disabled = locked; });
}

// 启动实时
$('live-start-btn').addEventListener('click', async () => {
  const btn = $('live-start-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 启动中...';

  // 获取模式
  const modeRadio = document.querySelector('input[name="live-mode"]:checked');
  const liveMode = modeRadio ? modeRadio.value : 'sim';

  // 真实模式提示
  if (liveMode === 'real') {
    if (!confirm('⚠️ 将启动真实交易模式，订单将发送到 Binance 账户！\n\n确定继续？')) {
      btn.disabled = false;
      btn.textContent = '🚀 启动实时';
      return;
    }
  }

  try {
    const res = await fetch('/api/live/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          leverage: Number($('live-leverage').value),
          stopLossPercent: Number($('live-stop').value) / 100,
          takeProfitPercent: Number($('live-tp').value) / 100,
          positionAmountValue: Number($('live-amount').value),
          mode: liveMode,
          interval: $('live-interval').value,
          direction: (document.querySelector('input[name="live-direction"]:checked') || {}).value || 'both',
        },
      }),
    });
    const data = await res.json();
    if (!data.success) { alert('启动失败: ' + data.error); btn.disabled = false; btn.textContent = '🚀 启动实时'; return; }
    liveRunning = true;
    $('live-start-btn').disabled = true;
    $('live-start-btn').textContent = '🚀 运行中';
    $('live-stop-btn').disabled = false;
    setLiveConfigLocked(true);
    // 立即获取一次状态
    const stateRes = await fetch('/api/live/state');
    const stateData = await stateRes.json();
    if (stateData.success && stateData.state) {
      liveState = stateData.state;
      renderLiveState();
    }
  } catch (err) { alert('请求失败: ' + err.message); btn.disabled = false; btn.textContent = '🚀 启动实时'; }
});

// 停止实时
$('live-stop-btn').addEventListener('click', async () => {
  try {
    await fetch('/api/live/stop', { method: 'POST' });
    liveRunning = false;
    $('live-start-btn').disabled = false;
    $('live-start-btn').textContent = '🚀 启动实时';
    $('live-stop-btn').disabled = true;
    setLiveConfigLocked(false);
    // 获取最终状态
    const stateRes = await fetch('/api/live/state');
    const stateData = await stateRes.json();
    if (stateData.success && stateData.state) {
      liveState = stateData.state;
      renderLiveState();
    }
  } catch (err) { alert('请求失败: ' + err.message); }
});

// ---- 回测历史管理 ----

/** 加载历史列表 */
async function loadHistoryList() {
  try {
    const list = $('bt-history-list');
    if (!list) return;
    const res = await fetch('/api/history');
    const data = await res.json();
    if (!data.success || !data.items) { list.innerHTML = '<p class="empty-hint">加载失败</p>'; return; }
    const empty = $('bt-history-empty');
    if (data.items.length === 0) {
      list.innerHTML = '<p class="empty-hint">暂无记录</p>';
      return;
    }
    list.innerHTML = data.items.map(item => {
      const d = new Date(item.timestamp);
      const time = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      const pctColor = item.totalReturnPct >= 0 ? '#22c55e' : '#ef4444';
      return `<div class="history-item" data-id="${item.id}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--card-border);cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='var(--card-hover)'" onmouseout="this.style.background='transparent'">
        <span style="color:#888;width:140px;flex-shrink:0;font-size:11px">${time}</span>
        <span style="color:#aaa;width:70px;font-size:11px">${item.symbol.toUpperCase()}</span>
        <span style="color:#888;width:30px;font-size:11px">${item.days}d</span>
        <span style="color:${pctColor};width:70px;font-weight:600;font-size:12px">${item.totalReturnPct >= 0 ? '+' : ''}${item.totalReturnPct}%</span>
        <span style="color:#f59e0b;width:60px;font-size:11px">🛑${item.stopCount}次</span>
        <span style="color:#888;width:50px;font-size:11px">📋${item.orderCount}单</span>
        <span style="flex:1"></span>
        <button class="btn-view" style="font-size:11px;padding:2px 8px;background:var(--card-border);border:none;border-radius:4px;color:var(--text);cursor:pointer">查看</button>
        <button class="btn-del" style="font-size:11px;padding:2px 6px;background:transparent;border:none;color:#ef4444;cursor:pointer" title="删除">✕</button>
      </div>`;
    }).join('');

    // 绑定事件
    list.querySelectorAll('.history-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.btn-view').addEventListener('click', (e) => { e.stopPropagation(); showHistoryDetail(id); });
      el.querySelector('.btn-del').addEventListener('click', (e) => { e.stopPropagation(); deleteHistoryItem(id); });
    });
  } catch (err) { console.warn('[History] 加载失败:', err); }
}

/** 显示历史详情（复用主结果区） */
async function showHistoryDetail(id) {
  try {
    const res = await fetch('/api/history/' + id);
    const data = await res.json();
    if (!data.success || !data.detail) { alert('获取详情失败'); return; }
    const d = data.detail;

    // 标记当前查看的历史
    window.__viewingHistoryId = id;

    // 更新标题栏
    const title = $('bt-progress-title');
    title.textContent = `📄 历史: ${d.symbol.toUpperCase()} ${d.days}d · ${d.totalReturnPct >= 0 ? '+' : ''}${d.totalReturnPct}%`;

    // 填充进度指标
    const totalReturn = d.totalReturnPct;
    const returnColor = totalReturn >= 0 ? '#22c55e' : '#ef4444';
    const baseTotal = d.config && d.config.initialBalance ? Number(d.config.initialBalance) : 2000;
    const totalEquity = baseTotal * (1 + totalReturn / 100);
    $('bt-progress-text').textContent = `${d.hoursElapsed} / ${d.hoursElapsed}`;
    $('bt-equity').textContent = `$${totalEquity.toFixed(2)}`;
    $('bt-equity').className = `value ${totalReturn >= 0 ? 'positive' : 'negative'}`;
    $('bt-pnl').textContent = `${totalReturn >= 0 ? '+' : ''}$${(totalEquity - baseTotal).toFixed(2)}`;
    $('bt-pnl').className = `value ${totalReturn >= 0 ? 'positive' : 'negative'}`;
    $('bt-return').textContent = `${totalReturn >= 0 ? '+' : ''}${totalReturn}%`;
    $('bt-return').className = `value ${totalReturn >= 0 ? 'positive' : 'negative'}`;
    $('bt-lot-count').textContent = '--';
    $('bt-fee').textContent = '--';
    $('bt-margin').textContent = '--';
    $('bt-total-open').textContent = d.orderCount;
    $('bt-tp-count').textContent = '--';
    $('bt-tp-amount').textContent = '--';
    $('bt-sl-count').textContent = d.stopCount;
    $('bt-sl-amount').textContent = '--';

    // 更新配置面板为历史参数
    if (d.config) {
      if (d.config.stopLossPercent !== undefined) {
        const sl = Math.round(Number(d.config.stopLossPercent) * 100 * 10) / 10;
        $('bt-stop').value = sl;
        $('bt-stop-val').value = sl.toFixed(1) + '%';
      }
      if (d.config.takeProfitPercent !== undefined) {
        const tp = Math.round(Number(d.config.takeProfitPercent) * 100 * 10) / 10;
        $('bt-tp').value = tp;
        $('bt-tp-val').value = tp.toFixed(1) + '%';
      }
      if (d.config.leverage !== undefined) {
        $('bt-leverage').value = d.config.leverage;
        $('bt-leverage-val').value = d.config.leverage + 'x';
      }
      if (d.config.interval !== undefined) {
        $('bt-interval').value = d.config.interval;
      }
      if (d.config.positionAmountValue !== undefined) {
        $('bt-amount').value = d.config.positionAmountValue;
        $('bt-amount-val').value = '$' + d.config.positionAmountValue;
      }
      if (d.config.initialBalance !== undefined) {
        $('bt-initial-balance').value = d.config.initialBalance;
        $('bt-initial-balance-val').value = String(d.config.initialBalance);
      }
      if (d.config.direction) {
        const rad = document.querySelector('input[name="bt-direction"][value="' + d.config.direction + '"]');
        if (rad) rad.checked = true;
      }
    }
    if (d.symbol) {
      $('bt-symbol').value = d.symbol;
    }
    if (d.days) {
      $('bt-days').value = d.days;
      $('bt-days-val').value = String(d.days);
    }

    // 复制配置到实时面板
    if (d.config) {
      if (d.config.stopLossPercent !== undefined) {
        const sl = Math.round(Number(d.config.stopLossPercent) * 100 * 10) / 10;
        $('live-stop').value = sl;
        $('live-stop-val').value = sl.toFixed(1) + '%';
      }
      if (d.config.takeProfitPercent !== undefined) {
        const tp = Math.round(Number(d.config.takeProfitPercent) * 100 * 10) / 10;
        $('live-tp').value = tp;
        $('live-tp-val').value = tp.toFixed(1) + '%';
      }
      if (d.config.leverage !== undefined) {
        $('live-leverage').value = d.config.leverage;
        $('live-leverage-val').value = d.config.leverage + 'x';
      }
      if (d.config.positionAmountValue !== undefined) {
        $('live-amount').value = d.config.positionAmountValue;
        $('live-amount-val').value = '$' + d.config.positionAmountValue;
      }
      if (d.config.interval) {
        $('live-interval').value = d.config.interval;
      }
      if (d.config.direction) {
        const rad = document.querySelector('input[name="live-direction"][value="' + d.config.direction + '"]');
        if (rad) rad.checked = true;
      }
    }

    // 持仓列表 - 显示末平仓 + 统计
    if (d.positions && d.positions.length > 0) {
      const longPos = d.positions.filter(p => p.side === 'long');
      const shortPos = d.positions.filter(p => p.side === 'short');
      const renderPos = (list, side) => {
        if (list.length === 0) return '<p class="empty-hint">空</p>';
        return '<div style="display:grid;grid-template-columns:60px 80px 60px 70px;gap:4px;font-size:11px;color:#888;border-bottom:1px solid var(--card-border);padding-bottom:4px;margin-bottom:4px"><span>#</span><span>开仓价</span><span>数量</span><span>浮动盈亏</span></div>' +
          list.map((p, i) => {
            const color = p.pnl >= 0 ? '#22c55e' : '#ef4444';
            return `<div style="display:grid;grid-template-columns:60px 80px 60px 70px;gap:4px;font-size:11px;align-items:center"><span style="color:#888">#${i+1}</span><span>$${p.entryPrice.toFixed(1)}</span><span style="color:#aaa">${p.quantity.toFixed(6)}</span><span style="color:${color}">${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}</span></div>`;
          }).join('');
      };
      $('bt-long-list').innerHTML = renderPos(longPos, 'long');
      $('bt-short-list').innerHTML = renderPos(shortPos, 'short');
    } else if (d.orders && d.orders.length > 0) {
      const openCount = d.orders.filter(o => o.action.includes('开多') || o.action.includes('开空') || o.action.includes('开仓')).length;
      const addCount = d.orders.filter(o => o.action.includes('加仓')).length;
      const reduceCount = d.orders.filter(o => o.action.includes('减仓')).length;
      const stopCount = d.orders.filter(o => o.action.includes('止损') || o.action.includes('平仓') || o.action.includes('重开')).length;
      $('bt-long-list').innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">
        <div style="padding:6px;background:rgba(34,197,94,0.1);border-radius:6px;text-align:center">
          <div style="color:#22c55e;font-weight:600">🟢 开仓 ${openCount}</div>
        </div>
        <div style="padding:6px;background:rgba(245,158,11,0.1);border-radius:6px;text-align:center">
          <div style="color:#f59e0b;font-weight:600">📈 加仓 ${addCount}</div>
        </div>
        <div style="padding:6px;background:rgba(59,130,246,0.1);border-radius:6px;text-align:center">
          <div style="color:#3b82f6;font-weight:600">📉 减仓 ${reduceCount}</div>
        </div>
        <div style="padding:6px;background:rgba(239,68,68,0.1);border-radius:6px;text-align:center">
          <div style="color:#ef4444;font-weight:600">🛑 止损 ${stopCount}</div>
        </div>
      </div>
      <div style="margin-top:6px;font-size:11px;color:#888">最后一笔: ${d.orders[d.orders.length-1].action} @$${d.orders[d.orders.length-1].price.toFixed(0)}</div>`;
      $('bt-short-list').innerHTML = '<p class="empty-hint" style="color:#888">详情见下方操作日志</p>';
    } else {
      $('bt-long-list').innerHTML = '<p class="empty-hint">暂无记录</p>';
      $('bt-short-list').innerHTML = '<p class="empty-hint">暂无记录</p>';
    }

    // 图表（简单虚拟，显示订单曲线）
    const chartCtx = $('bt-chart').getContext('2d');
    if (btChart) { btChart.destroy(); btChart = null; }
    if (d.orders && d.orders.length > 1) {
      const cumPnl = [];
      let sum = 0;
      for (const o of d.orders) {
        sum += o.profit;
        cumPnl.push(Math.round((baseTotal + sum) * 100) / 100);
      }
      const labels = d.orders.map(o => o.time);
      btChart = new Chart(chartCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: '权益曲线',
            data: cumPnl,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.05)',
            fill: true, tension: 0.2, pointRadius: 0,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
          scales: { x: { ticks: { maxTicksLimit: 20, font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, callback: v => '$' + v.toFixed(0) } } },
        },
      });
    } else {
      $('bt-chart-section').classList.add('hidden');
    }

    // 多/空单PnL 表格（历史模式显示总盈亏）
    const pnlTable = $('bt-pnl-table');
    if (d.orders && d.orders.length > 0) {
      const firstEquity = baseTotal;
      const finalEquity = baseTotal * (1 + (d.totalReturnPct || 0) / 100);
      const totalProfit = finalEquity - firstEquity;
      pnlTable.innerHTML = `<div style="padding:6px 8px;background:rgba(59,130,246,0.08);border-radius:6px;text-align:center">
        <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">起始权益</div>
        <div style="color:#3b82f6;font-weight:600;font-size:13px;margin-top:2px">$${firstEquity.toFixed(2)}</div>
      </div>
      <div style="padding:6px 8px;background:rgba(245,158,11,0.08);border-radius:6px;text-align:center">
        <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">结算权益</div>
        <div style="color:${totalProfit >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">$${finalEquity.toFixed(2)}</div>
      </div>`;
    } else {
      pnlTable.innerHTML = '';
    }

    // 配置栏（放在日志区上方）
    const configHtml = Object.entries(d.config).map(([k, v]) =>
      `<span style="color:#888;font-size:11px">${k}: <b style="color:var(--text)">${v}</b></span>`
    ).join(' | ');

    // 订单日志
    let ordersHtml = '';
    if (d.orders && d.orders.length > 0) {
      ordersHtml = `<div style="font-size:11px;color:#888;margin-bottom:4px">${configHtml}</div>
        <div style="display:flex;gap:6px;color:#888;font-weight:600;font-size:11px;border-bottom:1px solid var(--card-border);padding:4px 0;position:sticky;top:0;background:#1a1d28;z-index:1">
          <span style="width:30px">#</span>
          <span style="width:100px">时间</span>
          <span style="width:80px">开盘价</span>
          <span style="width:80px">本时盈亏</span>
          <span>操作</span>
        </div>
        ${d.orders.map((o, i) => {
          const pnlColor = o.profit >= 0 ? '#22c55e' : '#ef4444';
          return `<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">
            <span style="width:30px;color:#888">${o.hour}</span>
            <span style="width:100px;color:#aaa">${o.time}</span>
            <span style="width:80px;color:#888">$${o.price.toFixed(0)}</span>
            <span style="width:80px;color:${pnlColor}">${o.profit >= 0 ? '+' : ''}${o.profit.toFixed(2)}</span>
            <span style="color:var(--yellow)">${o.action}</span>
          </div>`;
        }).join('')}`;
    } else {
      ordersHtml = '<p style="color:#888;font-size:12px">暂无订单记录</p>';
    }
    $('bt-log-list').innerHTML = ordersHtml;
  } catch (err) {
    alert('获取详情失败: ' + err.message);
  }
}

/** 删除一条历史 */
async function deleteHistoryItem(id) {
  if (!confirm('确定删除此回测记录？')) return;
  try {
    const res = await fetch('/api/history/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      // 如果正在查看这条历史，清空结果区
      if (window.__viewingHistoryId === id) {
        $('bt-progress-text').textContent = '0 / 0';
        $('bt-equity').textContent = '--';
        $('bt-pnl').textContent = '--';
        $('bt-return').textContent = '--';
        $('bt-lot-count').textContent = '0';
        $('bt-fee').textContent = '--';
        $('bt-margin').textContent = '--';
        $('bt-total-open').textContent = '0';
        $('bt-tp-count').textContent = '0';
        $('bt-tp-amount').textContent = '--';
        $('bt-sl-count').textContent = '0';
        $('bt-sl-amount').textContent = '--';
        $('bt-long-list').innerHTML = '<p class="empty-hint">暂无</p>';
        $('bt-short-list').innerHTML = '<p class="empty-hint">暂无</p>';
        $('bt-log-list').innerHTML = '';
        $('bt-progress-title').textContent = '📊 进度';
        if (btChart) { btChart.destroy(); btChart = null; }
        window.__viewingHistoryId = null;
      }
      loadHistoryList();
    } else {
      alert('删除失败: ' + (data.error || ''));
    }
  } catch { /* ignore */ }
}

// ---- 初始化图表 ----
Chart.defaults.color = '#b0b0b0';
Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';

const pnlCtx = $('pnl-chart').getContext('2d');
const pnlChart = new Chart(pnlCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'A 多', data: [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
      { label: 'B 空', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
      { label: '合并净值', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3, pointRadius: 0, borderDash: [4, 3] },
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'nearest' },
    scales: {
      x: { display: true, ticks: { maxTicksLimit: 8, color: '#888' } },
      y: { display: true, ticks: { color: '#888' } }
    },
    plugins: {
      legend: { labels: { color: '#ccc', boxWidth: 12, padding: 12 } }
    }
  }
});

const posCtx = $('position-chart').getContext('2d');
const posChart = new Chart(posCtx, {
  type: 'bar',
  data: {
    labels: [],
    datasets: [
      { label: 'A 持仓量', data: [], backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 3 },
      { label: 'B 持仓量', data: [], backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 3 },
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { display: true, ticks: { maxTicksLimit: 8, color: '#888' } },
      y: { display: true, beginAtZero: true, ticks: { color: '#888' } }
    },
    plugins: {
      legend: { labels: { color: '#ccc', boxWidth: 12, padding: 12 } }
    }
  }
});

// ---- WebSocket 连接 ----
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    statusDot.className = 'status-dot online';
    statusText.textContent = '已连接';
  };

  ws.onclose = () => {
    statusDot.className = 'status-dot offline';
    statusText.textContent = '已断开，5秒后重连...';
    setTimeout(connect, 5000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // 处理 v2 实时引擎状态
      if (data.type === 'liveState' && data.state) {
        liveState = data.state;
        if (liveState.running && !liveRunning) {
          liveRunning = true;
          $('live-start-btn').disabled = true;
          $('live-start-btn').textContent = '🚀 运行中';
          $('live-stop-btn').disabled = false;
          setLiveConfigLocked(true);
        } else if (!liveState.running && liveRunning) {
          liveRunning = false;
          $('live-start-btn').disabled = false;
          $('live-start-btn').textContent = '🚀 启动实时';
          $('live-stop-btn').disabled = true;
          setLiveConfigLocked(false);
        }
        if (mode === 'live') {
          renderLiveState();
        }
        return;
      }
      // 处理 v1 实时快照
      if (mode !== 'live') return;
      updateDashboard(data);
    } catch (e) { /* ignore */ }
  };
}

// ---- 更新实时仪表盘 ----
function updateDashboard(data) {
  // 旧版 v1 面板元素可能不存在（已被 v2 面板替换）
  if (!$('current-price')) return;
  if (data.startTime && !startTimeSet) {
    startTime = data.startTime;
    startTimeSet = true;
  }

  const { currentPrice, accounts, totalEquity, elapsedHours, logEntries } = data;
  const [a, b] = accounts;
  const initialTotal = 2000;
  const totalPnl = totalEquity - initialTotal;

  $('current-price').textContent = formatPrice(currentPrice);
  $('total-equity').textContent = formatUsd(totalEquity);
  $('total-pnl').textContent = formatUsd(totalPnl);
  $('total-pnl').className = `value ${totalPnl >= 0 ? 'positive' : 'negative'}`;

  updateAccountPanel('a', a, currentPrice);
  updateAccountPanel('b', b, currentPrice);

  // P&L 图表
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (historyA.length > 1200) {
    historyA.shift(); historyB.shift(); historyTotal.shift(); pnlChart.data.labels.shift();
  }
  historyA.push(a.equity);
  historyB.push(b.equity);
  historyTotal.push(totalEquity);
  pnlChart.data.labels.push(t);
  pnlChart.data.datasets[0].data = [...historyA];
  pnlChart.data.datasets[1].data = [...historyB];
  pnlChart.data.datasets[2].data = [...historyTotal];
  pnlChart.update('none');

  // 持仓量柱状图（仅在小时边界时记录）
  const qtyA = a.position ? a.position.quantity : 0;
  const qtyB = b.position ? b.position.quantity : 0;
  const hourLabel = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  if (elapsedHours !== lastPosHour) {
    lastPosHour = elapsedHours;
    if (posHistory.length > 48) { posHistory.shift(); posChart.data.labels.shift(); }
    posHistory.push({ qtyA, qtyB });
    posChart.data.labels.push(hourLabel);
    posChart.data.datasets[0].data = [...posHistory.map(p => p.qtyA)];
    posChart.data.datasets[1].data = [...posHistory.map(p => p.qtyB)];
    posChart.update('none');
  }

  // 日志
  if (logEntries && logEntries.length > 0) {
    const logList = $('log-list');
    logList.innerHTML = logEntries.map(e => `<div class="log-line">${e}</div>`).join('');
    logList.scrollTop = logList.scrollHeight;
  }
}

function updateAccountPanel(prefix, acc, currentPrice) {
  const pnl = acc.unrealizedPnL;

  $(`${prefix}-balance`).textContent = formatUsd(acc.balance);
  $(`${prefix}-equity`).textContent = formatUsd(acc.equity);
  $(`${prefix}-pnl`).textContent = formatUsd(pnl);
  $(`${prefix}-pnl`).className = `value ${pnl >= 0 ? 'positive' : 'negative'}`;

  if (acc.position) {
    $(`${prefix}-qty`).textContent = acc.position.quantity.toFixed(6);
    $(`${prefix}-avg`).textContent = formatPrice(acc.position.averageEntryPrice);
  } else {
    $(`${prefix}-qty`).textContent = '--';
    $(`${prefix}-avg`).textContent = '--';
  }
}

// ---- 工具函数 ----
function formatPrice(v) {
  if (v >= 1000) return `$${(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v >= 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}
function formatUsd(v) { return `$${v.toFixed(2)}`; }
function formatDuration(start) {
  const sec = Math.floor((Date.now() - start) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

// ---- 启动 ----
async function init() {
  try {
    const res = await fetch('/config.json');
    window.__config = await res.json();
  } catch (e) {
    window.__config = {};
  }
  connect();
  switchMode('live');

  // 恢复服务端实时引擎状态
  try {
    var res = await fetch('/api/live/state');
    var data = await res.json();
    if (!data.success || !data.state) return;
    var s = data.state;
    var cfg = s.config || {};
    if (cfg.leverage) { $('live-leverage').value = cfg.leverage; $('live-leverage-val').value = cfg.leverage + 'x'; }
    if (cfg.stopLossPercent) { var sl = Math.round(cfg.stopLossPercent * 1000) / 10; $('live-stop').value = sl; $('live-stop-val').value = sl.toFixed(1) + '%'; }
    if (cfg.takeProfitPercent) { var tp = Math.round(cfg.takeProfitPercent * 1000) / 10; $('live-tp').value = tp; $('live-tp-val').value = tp.toFixed(1) + '%'; }
    if (cfg.positionAmountValue) { $('live-amount').value = cfg.positionAmountValue; $('live-amount-val').value = '$' + cfg.positionAmountValue; }
    if (cfg.interval) $('live-interval').value = cfg.interval;
    if (cfg.direction) { var rad = document.querySelector('input[name="live-direction"][value="' + cfg.direction + '"]'); if (rad) rad.checked = true; }
    if (cfg.mode) { var mr = document.querySelector('input[name="live-mode"][value="' + cfg.mode + '"]'); if (mr) mr.checked = true; }
    if (s.running) {
      liveState = s;
      liveRunning = true;
      startTime = s.startTime || Date.now();
      $('live-start-btn').disabled = true;
      $('live-start-btn').textContent = '🚀 运行中';
      $('live-stop-btn').disabled = false;
      setLiveConfigLocked(true);
      renderLiveState();
    }
  } catch(e) {}

  setInterval(() => {
    if (startTime) $('run-time').textContent = formatDuration(startTime);
  }, 1000);

  // 回测历史绑定
  $('bt-history-refresh').addEventListener('click', function(){ location.reload(); });
  loadHistoryList();
}

init();
