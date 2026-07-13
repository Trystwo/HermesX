// Live mode logic
import { AppState } from './state.js';
import { $, fmtPrice, fmtUsd, bindSlider } from './ui.js';
import { updateChart } from './charts.js';
import { t, applyTranslations } from './i18n.js';

export function initLive() {
  bindSlider('live-stop', 'live-stop-val', '%');
  bindSlider('live-tp', 'live-tp-val', '%');
  bindSlider('live-amount', 'live-amount-val', '');
  bindSlider('live-leverage', 'live-leverage-val', 'x');

  $('live-start-btn').addEventListener('click', async () => {
    const btn = $('live-start-btn');
    btn.disabled = true;
    btn.textContent = t('Starting') + '...';

    const modeRadio = document.querySelector('input[name="live-mode"]:checked');
    const liveMode = modeRadio ? modeRadio.value : 'sim';

    if (liveMode === 'real' && !confirm(t('Start REAL trading on Binance?'))) {
      btn.disabled = false;
      btn.textContent = t('Start Live');
      return;
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
            direction: document.querySelector('input[name="live-direction"]:checked')?.value || 'both',
          },
        }),
      });
      const data = await res.json();
      if (!data.success) { alert(t('Request failed') + ': ' + data.error); btn.disabled = false; btn.textContent = t('Start Live'); return; }

      AppState.liveRunning = true;
      $('live-start-btn').disabled = true;
      $('live-start-btn').textContent = t('Running');
      $('live-stop-btn').disabled = false;
      setLiveConfigLocked(true);

      const stateRes = await fetch('/api/live/state');
      const stateData = await stateRes.json();
      if (stateData.success && stateData.state) {
        AppState.liveState = stateData.state;
        renderLiveState();
      }
    } catch (err) { alert(t('Request failed') + ': ' + err.message); btn.disabled = false; btn.textContent = t('Start Live'); }
  });

  $('live-stop-btn').addEventListener('click', async () => {
    try {
      await fetch('/api/live/stop', { method: 'POST' });
    } catch (err) { /* ignore */ }
    AppState.liveRunning = false;
    $('live-start-btn').disabled = false;
    $('live-start-btn').textContent = t('Start Live');
    $('live-stop-btn').disabled = true;
    setLiveConfigLocked(false);
  });
}

export function renderLiveState() {
  const s = AppState.liveState;
  if (!s) return;

  const initialBalance = s.config?.initialBalance || 1000;
  const lastPrice = s.lastPrice || 0;

  let longPnL = 0, shortPnL = 0, totalMargin = 0;
  for (const l of (s.longLots || [])) {
    longPnL += (lastPrice - l.entryPrice) * l.quantity;
    totalMargin += l.margin || 0;
  }
  for (const l of (s.shortLots || [])) {
    shortPnL += (l.entryPrice - lastPrice) * l.quantity;
    totalMargin += l.margin || 0;
  }
  const totalEquity = s.balance + longPnL + shortPnL;
  const totalPnl = totalEquity - initialBalance;
  const returnPct = initialBalance > 0 ? (totalPnl / initialBalance * 100) : 0;

  // Mode badge
  const badge = $('live-mode-badge');
  if (badge) {
    if (s.config?.mode === 'real') {
      badge.textContent = t('Real Trading'); badge.style.background = 'rgba(239,68,68,0.1)'; badge.style.color = '#ef4444';
    } else {
      badge.textContent = t('Simulation'); badge.style.background = 'rgba(34,197,94,0.1)'; badge.style.color = '#22c55e';
    }
  }

  $('bt-chart-section')?.classList.remove('hidden');

  $('bt-progress-text').textContent = s.running ? t('Running') : t('Stopped');
  $('bt-equity').textContent = fmtPrice(totalEquity);
  $('bt-pnl').textContent = fmtUsd(totalPnl);
  $('bt-pnl').className = 'value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  $('bt-return').textContent = (returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%';
  $('bt-return').className = 'value ' + (returnPct >= 0 ? 'positive' : 'negative');
  $('bt-lot-count').textContent = (s.longLots?.length || 0) + (s.shortLots?.length || 0);
  $('bt-fee').textContent = '$' + (s.totalFee ?? 0).toFixed(2);
  $('bt-margin').textContent = fmtPrice(totalMargin);
  $('bt-total-open').textContent = s.totalOpenCount ?? 0;

  // TP/SL stats
  let tpTotal = 0, slTotal = 0, tpAmt = 0, slAmt = 0;
  for (const snap of (s.snapshots || [])) {
    if (snap.stoppedLots) {
      for (const l of snap.stoppedLots) {
        if (l.reason === 'tp') { tpTotal++; tpAmt += l.pnl || 0; }
        else { slTotal++; slAmt += l.pnl || 0; }
      }
    }
  }
  $('bt-tp-count').textContent = tpTotal;
  $('bt-tp-amount').textContent = fmtUsd(tpAmt);
  $('bt-tp-amount').className = 'value positive';
  $('bt-sl-count').textContent = slTotal;
  $('bt-sl-amount').textContent = fmtUsd(slAmt);
  $('bt-sl-amount').className = 'value negative';

  if (s.snapshots?.length >= 2) {
    updateChart(s.snapshots, initialBalance);
  }

  // PnL table
  const pnlTable = $('bt-pnl-table');
  if (s.snapshots?.length > 0) {
    const last = s.snapshots[s.snapshots.length - 1];
    pnlTable.innerHTML = `<div style="padding:6px 8px;background:rgba(34,197,94,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px">${t('Long PnL')}</div>
      <div style="color:${last.longPnL >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${last.longPnL >= 0 ? '+' : ''}$${last.longPnL.toFixed(2)}</div>
    </div>
    <div style="padding:6px 8px;background:rgba(239,68,68,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px">${t('Short PnL')}</div>
      <div style="color:${last.shortPnL >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${last.shortPnL >= 0 ? '+' : ''}$${last.shortPnL.toFixed(2)}</div>
    </div>`;
  }

  // Position lots
  if (lastPrice > 0) {
    renderLiveLots('bt-long-list', s.longLots, lastPrice, 'long');
    renderLiveLots('bt-short-list', s.shortLots, lastPrice, 'short');
  }

  // Log
  if (s.logEntries?.length > 0) {
    const logList = $('bt-log-list');
    logList.innerHTML = s.logEntries.map(msg => {
      // Translate action keywords in log messages
      let translated = msg;
      for (const [en, zh] of Object.entries(translationsMap)) {
        translated = translated.split(en).join(zh);
      }
      return `<div>${translated}</div>`;
    }).join('');
    logList.scrollTop = logList.scrollHeight;
  }

  applyTranslations();
}

// Map for translating server log messages
const translationsMap = {
  'engine started': '引擎已启动',
  'engine stopped': '引擎已停止',
  'insufficient equity': '权益不足',
  'open long': '开多',
  'open short': '开空',
  'sl:': '止损:',
  'tp:': '止盈:',
};

function renderLiveLots(containerId, lots, price, side) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!lots || lots.length === 0) {
    container.innerHTML = `<p class="empty-hint">${t('None')}</p>`;
    return;
  }
  container.innerHTML = lots.map((lot, i) => {
    const pnl = side === 'long' ? (price - lot.entryPrice) * lot.quantity : (lot.entryPrice - price) * lot.quantity;
    const color = pnl >= 0 ? '#22c55e' : '#ef4444';
    return `<div style="display:flex;gap:6px;font-size:11px;padding:2px 0">
      <span style="color:#888;width:20px">#${i+1}</span>
      <span style="width:80px">${fmtPrice(lot.entryPrice)}</span>
      <span style="color:${color}">${fmtUsd(pnl)}</span>
    </div>`;
  }).join('');
}

function setLiveConfigLocked(locked) {
  ['live-stop','live-tp','live-amount','live-leverage','live-interval','live-symbol'].forEach(id => {
    const el = $(id);
    if (el) el.disabled = locked;
  });
  document.querySelectorAll('input[name="live-direction"]').forEach(r => r.disabled = locked);
  document.querySelectorAll('input[name="live-mode"]').forEach(r => r.disabled = locked);
}
