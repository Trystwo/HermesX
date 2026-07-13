// DOM utilities

export const $ = (id) => document.getElementById(id);

export function fmtPrice(v) {
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + v.toFixed(2);
}

export function fmtUsd(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

export function bindSlider(inputId, displayId, suffix) {
  const input = $(inputId);
  const display = $(displayId);
  if (!input || !display) return;
  const update = () => { display.value = input.value + suffix; };
  input.addEventListener('input', update);
  display.addEventListener('input', () => {
    const val = parseFloat(display.value);
    if (!isNaN(val)) {
      input.value = Math.max(input.min || 0, Math.min(input.max || Infinity, val));
      update();
    }
  });
  display.addEventListener('blur', update);
  update();
}

export function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
}
