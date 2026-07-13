// Chart.js wrapper
import { $, formatTime } from './ui.js';

let btChart = null;

export function updateChart(snapshots, initialBalance) {
  if (!snapshots || snapshots.length < 2) return;

  const labels = snapshots.map(s => formatTime(s.timestamp));
  const equityData = snapshots.map(s => s.equity);
  const baseline = snapshots.map(() => initialBalance);

  const ctx = $('bt-chart').getContext('2d');

  if (btChart) {
    if (btChart.data.datasets.length < 2) {
      btChart.destroy();
      btChart = null;
    } else {
      btChart.data.labels = labels;
      btChart.data.datasets[0].data = equityData;
      btChart.data.datasets[1].data = baseline;
      btChart.update('none');
      return;
    }
  }

  btChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Equity', data: equityData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.2, pointRadius: 0 },
        { label: 'Initial', data: baseline, borderColor: '#888', borderDash: [4,4], backgroundColor: 'transparent', tension: 0, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } },
      scales: {
        x: { ticks: { maxTicksLimit: 20, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 }, callback: v => '$' + v.toFixed(0) } },
      },
    },
  });
}

export function destroyChart() {
  if (btChart) { btChart.destroy(); btChart = null; }
}

export function getChart() { return btChart; }
