// History management
import { AppState } from './state.js';
import { $, fmtPrice, fmtUsd } from './ui.js';
import { destroyChart } from './charts.js';
import { t, applyTranslations } from './i18n.js';

export async function loadHistoryList() {
  try {
    const list = $('bt-history-list');
    if (!list) return;
    const res = await fetch('/api/history');
    const data = await res.json();
    if (!data.success || !data.items) { list.innerHTML = `<p class="empty-hint">${t('Load failed')}</p>`; return; }
    if (data.items.length === 0) {
      list.innerHTML = `<p class="empty-hint">${t('No records')}</p>`;
      return;
    }
    list.innerHTML = data.items.map(item => {
      const d = new Date(item.timestamp);
      const time = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const pctColor = item.totalReturnPct >= 0 ? '#22c55e' : '#ef4444';
      return `<div class="history-item" data-id="${item.id}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--card-border);cursor:pointer">
        <span style="color:#888;width:140px;flex-shrink:0;font-size:11px">${time}</span>
        <span style="color:#aaa;width:70px;font-size:11px">${(item.symbol || '').toUpperCase()}</span>
        <span style="color:#888;width:30px;font-size:11px">${item.days}d</span>
        <span style="color:${pctColor};width:70px;font-weight:600;font-size:12px">${item.totalReturnPct >= 0 ? '+' : ''}${item.totalReturnPct}%</span>
        <span style="color:#f59e0b;width:60px;font-size:11px">SL:${item.stopCount}</span>
        <span style="color:#888;width:50px;font-size:11px">Ord:${item.orderCount}</span>
        <span style="flex:1"></span>
        <button class="btn-view" style="font-size:11px;padding:2px 8px;background:var(--card-border);border:none;border-radius:4px;color:var(--text);cursor:pointer">${t('View')}</button>
        <button class="btn-del" style="font-size:11px;padding:2px 6px;background:transparent;border:none;color:#ef4444;cursor:pointer">x</button>
      </div>`;
    }).join('');

    list.querySelectorAll('.history-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.btn-view').addEventListener('click', e => { e.stopPropagation(); showHistoryDetail(id); });
      el.querySelector('.btn-del').addEventListener('click', e => { e.stopPropagation(); deleteHistoryItem(id); });
    });
  } catch (err) { console.warn('[History] load failed:', err); }
}

export async function showHistoryDetail(id) {
  try {
    const res = await fetch('/api/history/' + id);
    const data = await res.json();
    if (!data.success || !data.detail) { alert(t('Failed to get detail')); return; }
    const d = data.detail;

    window.__viewingHistoryId = id;

    $('bt-progress-title').textContent = `${t('History')}: ${(d.symbol || '').toUpperCase()} ${d.days}d`;
    const totalReturn = d.totalReturnPct || 0;
    const baseTotal = d.config?.initialBalance ? Number(d.config.initialBalance) : 1000;
    const totalEquity = baseTotal * (1 + totalReturn / 100);

    $('bt-progress-text').textContent = `${d.hoursElapsed} / ${d.hoursElapsed}`;
    $('bt-equity').textContent = '$' + totalEquity.toFixed(2);
    $('bt-pnl').textContent = `${totalReturn >= 0 ? '+' : ''}$${(totalEquity - baseTotal).toFixed(2)}`;
    $('bt-return').textContent = `${totalReturn >= 0 ? '+' : ''}${totalReturn}%`;
    $('bt-lot-count').textContent = '--';
    $('bt-fee').textContent = '--';
    $('bt-margin').textContent = '--';
    $('bt-total-open').textContent = d.orderCount;
    $('bt-tp-count').textContent = '--';
    $('bt-tp-amount').textContent = '--';
    $('bt-sl-count').textContent = d.stopCount;
    $('bt-sl-amount').textContent = '--';

    if (d.config) {
      const restore = (btId, liveId, val, suffix) => {
        if (val !== undefined) {
          const btEl = $(btId); if (btEl) btEl.value = val;
          const btDisplay = $(btId + '-val'); if (btDisplay) btDisplay.value = val + (suffix || '');
          const liveEl = $(liveId); if (liveEl) liveEl.value = val;
          const liveDisplay = $(liveId + '-val'); if (liveDisplay) liveDisplay.value = val + (suffix || '');
        }
      };
      if (d.config.stopLossPercent !== undefined) {
        const sl = Math.round(Number(d.config.stopLossPercent) * 1000) / 10;
        restore('bt-stop', 'live-stop', sl, '%');
      }
      if (d.config.takeProfitPercent !== undefined) {
        const tp = Math.round(Number(d.config.takeProfitPercent) * 1000) / 10;
        restore('bt-tp', 'live-tp', tp, '%');
      }
      if (d.config.leverage !== undefined) restore('bt-leverage', 'live-leverage', d.config.leverage, 'x');
      if (d.config.positionAmountValue !== undefined) restore('bt-amount', 'live-amount', d.config.positionAmountValue, '');
      if (d.config.initialBalance !== undefined) restore('bt-initial-balance', 'bt-initial-balance', d.config.initialBalance, '');
      if (d.config.interval) {
        const i = $('bt-interval'); if (i) i.value = d.config.interval;
        const li = $('live-interval'); if (li) li.value = d.config.interval;
      }
      if (d.config.direction) {
        ['bt', 'live'].forEach(prefix => {
          const rad = document.querySelector(`input[name="${prefix}-direction"][value="${d.config.direction}"]`);
          if (rad) rad.checked = true;
        });
      }
    }

    if (d.symbol) { const s = $('bt-symbol'); if (s) s.value = d.symbol; }
    if (d.days) { const dd = $('bt-days'); if (dd) dd.value = d.days; const dv = $('bt-days-val'); if (dv) dv.value = String(d.days); }

    $('bt-long-list').innerHTML = renderHistoryPositions((d.positions || []).filter(p => p.side === 'long'));
    $('bt-short-list').innerHTML = renderHistoryPositions((d.positions || []).filter(p => p.side === 'short'));

    let ordersHtml = '';
    if (d.orders && d.orders.length > 0) {
      ordersHtml = `<div style="font-size:11px;margin-bottom:4px;color:#888">${Object.entries(d.config || {}).map(([k,v]) => `${k}: ${v}`).join(' | ')}</div>
        <div style="display:flex;gap:6px;color:#888;font-weight:600;font-size:11px;border-bottom:1px solid var(--card-border);padding:4px 0">
          <span style="width:30px">#</span><span style="width:100px">${t('Time')}</span><span style="width:80px">${t('Price')}</span><span>${t('Action')}</span>
        </div>
        ${d.orders.map(o => `<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">
          <span style="width:30px;color:#888">${o.hour}</span>
          <span style="width:100px;color:#aaa">${o.time}</span>
          <span style="width:80px;color:#888">$${o.price.toFixed(0)}</span>
          <span style="color:var(--yellow)">${o.action}</span>
        </div>`).join('')}`;
    }
    $('bt-log-list').innerHTML = ordersHtml || `<p style="color:#888;font-size:12px">${t('No orders')}</p>`;

    destroyChart();
    if (d.orders?.length > 1) {
      const ctx = $('bt-chart').getContext('2d');
      const cumPnl = [];
      let sum = 0;
      for (const o of d.orders) { sum += o.profit; cumPnl.push(Math.round((baseTotal + sum) * 100) / 100); }
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: d.orders.map(o => o.time),
          datasets: [{ label: 'Equity', data: cumPnl, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)', fill: true, tension: 0.2, pointRadius: 0 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
          scales: { x: { ticks: { maxTicksLimit: 20, font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, callback: v => '$' + v.toFixed(0) } } },
        },
      });
    }
  } catch (err) { alert(t('Failed to get detail') + ': ' + err.message); }
}

export async function deleteHistoryItem(id) {
  if (!confirm(t('Delete this record?'))) return;
  try {
    const res = await fetch('/api/history/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      if (window.__viewingHistoryId === id) {
        ['equity','pnl','return','fee','margin'].forEach(k => { const el = $('bt-'+k); if (el) el.textContent = '--'; });
        destroyChart();
      }
      loadHistoryList();
    } else {
      alert(t('Delete failed') + ': ' + (data.error || ''));
    }
  } catch { /* ignore */ }
}

function renderHistoryPositions(positions) {
  if (!positions || positions.length === 0) return `<p class="empty-hint">${t('None')}</p>`;
  return positions.map((p, i) => {
    const color = p.pnl >= 0 ? '#22c55e' : '#ef4444';
    return `<div style="display:flex;gap:6px;font-size:11px;padding:2px 0">
      <span style="color:#888;width:20px">#${i+1}</span>
      <span style="width:80px">${fmtPrice(p.entryPrice)}</span>
      <span style="color:${color}">${fmtUsd(p.pnl)}</span>
    </div>`;
  }).join('');
}
