// Backtest mode logic
import { AppState } from './state.js';
import { $, fmtPrice, fmtUsd, bindSlider } from './ui.js';
import { updateChart, destroyChart } from './charts.js';
import { loadHistoryList } from './history.js';
import { t } from './i18n.js';

export function initBacktest() {
  bindSlider('bt-days', 'bt-days-val', '');
  bindSlider('bt-stop', 'bt-stop-val', '%');
  bindSlider('bt-tp', 'bt-tp-val', '%');
  bindSlider('bt-amount', 'bt-amount-val', '');
  bindSlider('bt-leverage', 'bt-leverage-val', 'x');
  bindSlider('bt-initial-balance', 'bt-initial-balance-val', '');

  $('bt-init-btn').addEventListener('click', async () => {
    const btn = $('bt-init-btn');
    btn.disabled = true;
    btn.textContent = t('Loading') + '...';
    try {
      const res = await fetch('/api/backtest/init', {
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
          direction: document.querySelector('input[name="bt-direction"]:checked')?.value || 'both',
        }),
      });
      const data = await res.json();
      if (!data.success) { alert(t('Init failed') + ': ' + data.error); btn.disabled = false; btn.textContent = t('Init'); return; }
      AppState.btState = data.state;
      AppState.btID = data.state.symbol;
      destroyChart();
      $('bt-chart-section').classList.remove('hidden');
      renderBtState();
      $('bt-step-btn').disabled = false;
      $('bt-runall-btn').disabled = false;
    } catch (err) { alert(t('Request failed') + ': ' + err.message); }
    btn.disabled = false;
    btn.textContent = t('Init');
  });

  $('bt-step-btn').addEventListener('click', async () => {
    if (!AppState.btID) return;
    $('bt-step-btn').disabled = true;
    try {
      const res = await fetch('/api/backtest/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: AppState.btID }),
      });
      const data = await res.json();
      if (!data.success) { alert(t('Step failed') + ': ' + data.error); return; }
      AppState.btState = data.state;
      renderBtState();
    } catch (err) { alert(t('Request failed') + ': ' + err.message); }
  });

  $('bt-runall-btn').addEventListener('click', async () => {
    if (!AppState.btID) return;
    $('bt-runall-btn').disabled = true;
    $('bt-step-btn').disabled = true;
    try {
      const res = await fetch('/api/backtest/runAll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: AppState.btID }),
      });
      const data = await res.json();
      if (!data.success) { alert(t('Run failed') + ': ' + data.error); return; }
      AppState.btState = data.state;
      renderBtState();
      loadHistoryList();
    } catch (err) { alert(t('Request failed') + ': ' + err.message); }
  });
}

function renderLots(containerId, lots, currentPrice, side) {
  const el = $(containerId);
  if (!lots || lots.length === 0) {
    el.innerHTML = `<p class="empty-hint">${t('None')}</p>`;
    return;
  }
  el.innerHTML = `<div style="display:grid;grid-template-columns:60px 80px 60px 70px;gap:4px;font-size:11px;color:#888;border-bottom:1px solid var(--card-border);padding-bottom:4px;margin-bottom:4px">
    <span>#</span><span>${t('Entry')}</span><span>${t('Qty')}</span><span>${t('PnL')}</span></div>`
    + lots.map((lot, i) => {
      const pnl = side === 'long' ? (currentPrice - lot.entryPrice) * lot.quantity : (lot.entryPrice - currentPrice) * lot.quantity;
      const color = pnl >= 0 ? '#22c55e' : '#ef4444';
      return `<div style="display:grid;grid-template-columns:60px 80px 60px 70px;gap:4px;font-size:11px;align-items:center">
        <span style="color:#888">#${i + 1}</span>
        <span>${fmtPrice(lot.entryPrice)}</span>
        <span style="color:#aaa">${lot.quantity.toFixed(6)}</span>
        <span style="color:${color}">${fmtUsd(pnl)}</span>
      </div>`;
    }).join('');
}

export function renderBtState() {
  const s = AppState.btState;
  if (!s) return;

  const total = s.candles?.length || 0;
  const idx = s.currentIndex || 0;
  const price = idx > 0 && s.candles ? s.candles[idx - 1].open : (s.snapshots?.length > 0 ? s.snapshots[s.snapshots.length - 1].openPrice : 0);
  const initialBalance = s.initialBalance || 1000;

  let totalMargin = 0, unrealizedPnL = 0;
  if (idx > 0 && s.candles) {
    const cp = s.candles[idx - 1].open;
    for (const lot of (s.longLots || [])) {
      totalMargin += lot.margin || 0;
      unrealizedPnL += (cp - lot.entryPrice) * lot.quantity;
    }
    for (const lot of (s.shortLots || [])) {
      totalMargin += lot.margin || 0;
      unrealizedPnL += (lot.entryPrice - cp) * lot.quantity;
    }
  }
  const totalEquity = s.balance + totalMargin + unrealizedPnL;
  const totalPnl = totalEquity - initialBalance;
  const returnPct = initialBalance > 0 ? (totalPnl / initialBalance * 100) : 0;

  $('bt-progress-text').textContent = `${idx} / ${total}`;
  $('bt-equity').textContent = fmtPrice(totalEquity);
  $('bt-pnl').textContent = fmtUsd(totalPnl);
  $('bt-pnl').className = 'value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  $('bt-return').textContent = (returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%';
  $('bt-return').className = 'value ' + (returnPct >= 0 ? 'positive' : 'negative');
  $('bt-lot-count').textContent = (s.longLots?.length || 0) + (s.shortLots?.length || 0);
  $('bt-fee').textContent = '$' + (s.totalFee ?? 0).toFixed(2);
  $('bt-margin').textContent = fmtPrice(totalMargin);
  $('bt-total-open').textContent = s.totalOpenCount ?? 0;

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

  updateChart(s.snapshots, initialBalance);

  const pnlTable = $('bt-pnl-table');
  if (s.snapshots?.length > 0) {
    const last = s.snapshots[s.snapshots.length - 1];
    const longPnl = last.longPnL || 0;
    const shortPnl = last.shortPnL || 0;
    pnlTable.innerHTML = `<div style="padding:6px 8px;background:rgba(34,197,94,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px">${t('Long PnL')}</div>
      <div style="color:${longPnl >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${longPnl >= 0 ? '+' : ''}$${longPnl.toFixed(2)}</div>
    </div>
    <div style="padding:6px 8px;background:rgba(239,68,68,0.08);border-radius:6px;text-align:center">
      <div style="color:#888;font-size:10px">${t('Short PnL')}</div>
      <div style="color:${shortPnl >= 0 ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;margin-top:2px">${shortPnl >= 0 ? '+' : ''}$${shortPnl.toFixed(2)}</div>
    </div>`;
  }

  const lastPrice = idx > 0 && s.candles ? s.candles[idx - 1].open : 0;
  renderLots('bt-long-list', s.longLots, lastPrice, 'long');
  renderLots('bt-short-list', s.shortLots, lastPrice, 'short');

  const logList = $('bt-log-list');
  if (s.snapshots?.length > 0) {
    const seen = new Set();
    logList.innerHTML = s.snapshots.map(snap => {
      const d = new Date(snap.timestamp);
      const time = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
      let stopInfo = '';
      if (snap.stoppedLots?.length > 0) {
        const key = snap.hour + snap.stoppedLots.map(l => l.reason + l.side).join('');
        if (!seen.has(key)) {
          seen.add(key);
          stopInfo = ' | ' + snap.stoppedLots.map(l => `${l.reason === 'tp' ? t('TP') : t('SL')} ${l.side}@${fmtPrice(l.closePrice)}(${fmtUsd(l.pnl)})`).join(' ');
        }
      }
      return `<div style="font-size:11px">#${snap.hour} ${time} ${fmtPrice(snap.openPrice)} ${snap.action}${stopInfo}</div>`;
    }).join('');
    logList.scrollTop = logList.scrollHeight;
  }

  $('bt-step-btn').disabled = s.done;
  $('bt-runall-btn').disabled = s.done;
}
