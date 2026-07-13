// WebSocket connection management
import { AppState } from './state.js';
import { renderLiveState } from './live.js';
import { $ } from './ui.js';
import { t } from './i18n.js';

let ws = null;

export function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    $('status-indicator').className = 'status-dot online';
    $('status-text').textContent = t('Connected');
  };

  ws.onclose = () => {
    $('status-indicator').className = 'status-dot offline';
    $('status-text').textContent = t('Disconnected');
    setTimeout(connect, 5000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'liveState' && data.state) {
        AppState.liveState = data.state;

        if (data.state.running && !AppState.liveRunning) {
          AppState.liveRunning = true;
          $('live-toggle-btn').textContent = t('Stop');
          $('live-toggle-btn').disabled = false;
          setLiveConfigLocked(true);
        } else if (!data.state.running && AppState.liveRunning) {
          AppState.liveRunning = false;
          $('live-toggle-btn').textContent = t('Start');
          $('live-toggle-btn').disabled = false;
          setLiveConfigLocked(false);
        }

        if (AppState.mode === 'live') {
          renderLiveState();
        }
      }
    } catch (e) { /* ignore parse errors */ }
  };
}

function setLiveConfigLocked(locked) {
  ['live-stop','live-tp','live-amount','live-leverage','live-interval','live-symbol'].forEach(id => {
    const el = $(id);
    if (el) el.disabled = locked;
  });
  document.querySelectorAll('input[name="live-direction"]').forEach(r => r.disabled = locked);
  document.querySelectorAll('input[name="live-mode"]').forEach(r => r.disabled = locked);
}
