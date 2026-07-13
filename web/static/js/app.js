// App entry point
import { AppState } from './state.js';
import { $ } from './ui.js';
import { connect } from './ws.js';
import { initBacktest } from './backtest.js';
import { initLive, renderLiveState } from './live.js';
import { loadHistoryList } from './history.js';
import { initI18n, setLang, getLang, applyTranslations, t } from './i18n.js';

Chart.defaults.color = '#b0b0b0';
Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';

// Mode switching
function switchMode(newMode) {
  AppState.mode = newMode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === newMode);
  });
  $('live-panels').classList.toggle('hidden', newMode !== 'live');
  $('backtest-panels').classList.toggle('hidden', newMode !== 'backtest');
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === AppState.mode) return;
    switchMode(btn.dataset.mode);
  });
});

// Language toggle
$('lang-toggle').addEventListener('click', () => {
  const next = getLang() === 'zh' ? 'en' : 'zh';
  setLang(next);
  // Re-render dynamic content
  if (AppState.btState) {
    import('./backtest.js').then(m => m.renderBtState());
  }
  if (AppState.liveState && AppState.mode === 'live') {
    renderLiveState();
  }
});

// Initialize
async function init() {
  initI18n();
  initBacktest();
  initLive();
  connect();
  loadHistoryList();

  // Restore live state from server
  try {
    const res = await fetch('/api/live/state');
    const data = await res.json();
    if (data.success && data.state) {
      AppState.liveState = data.state;
      const s = data.state;
      const cfg = s.config || {};
      if (cfg.leverage) { $('live-leverage').value = cfg.leverage; $('live-leverage-val').value = cfg.leverage + 'x'; }
      if (cfg.stopLossPercent) { const sl = Math.round(cfg.stopLossPercent * 1000) / 10; $('live-stop').value = sl; $('live-stop-val').value = sl.toFixed(1) + '%'; }
      if (cfg.takeProfitPercent) { const tp = Math.round(cfg.takeProfitPercent * 1000) / 10; $('live-tp').value = tp; $('live-tp-val').value = tp.toFixed(1) + '%'; }
      if (cfg.positionAmountValue) { $('live-amount').value = cfg.positionAmountValue; $('live-amount-val').value = '$' + cfg.positionAmountValue; }
      if (cfg.interval) $('live-interval').value = cfg.interval;
      if (cfg.direction) { const r = document.querySelector(`input[name="live-direction"][value="${cfg.direction}"]`); if (r) r.checked = true; }
      if (cfg.mode) { const m = document.querySelector(`input[name="live-mode"][value="${cfg.mode}"]`); if (m) m.checked = true; }
      if (s.running) {
        AppState.liveRunning = true;
        $('live-toggle-btn').textContent = t('Stop');
        renderLiveState();
      }
    }
  } catch (e) { /* ignore */ }

  switchMode('live');
  $('bt-history-refresh').addEventListener('click', loadHistoryList);
}

init();
