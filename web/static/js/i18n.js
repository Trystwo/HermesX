// i18n — Chinese/English translation module

const zh = {
  // Header
  subtitle: '多空双开 · 回测与实时模拟',
  Live: '实时',
  Backtest: '回测',
  Connecting: '连接中...',
  Connected: '已连接',
  Disconnected: '已断开，5 秒后重连...',

  // Live Config
  'Live Config': '实时配置',
  Simulation: '模拟',
  'Real Trading': '实盘交易',
  Symbol: '交易对',
  'Stop Loss %': '止损 %',
  'Take Profit %': '止盈 %',
  'Amount $': '每单 $',
  Leverage: '杠杆',
  Interval: '周期',
  Direction: '方向',
  Both: '多空双开',
  'Long Only': '只开多',
  'Short Only': '只开空',
  'Start Live': '启动实时',
  'Stop Live': '停止实时',
  Mode: '模式',
  Sim: '模拟',
  Real: '实盘',
  Starting: '启动中...',
  Running: '运行中',
  Stopped: '已停止',
  confirm_real: '将启动真实交易模式！\n\n确定继续？',
  'Start REAL trading on Binance?': '将启动币安实盘交易！\n\n确定继续？',

  // Backtest Config
  'Backtest Config': '回测配置',
  Days: '天数',
  'Initial $': '初始 $',
  Init: '初始化',
  Step: '下一步',
  'Run All': '全部运行',
  Loading: '获取数据中...',
  'Init failed': '初始化失败',
  'Step failed': '步骤失败',
  'Run failed': '运行失败',
  'Request failed': '请求失败',

  // Progress
  Progress: '进度',
  Candles: 'K 线',
  Equity: '权益',
  'P&L': '盈亏',
  Return: '收益率',
  'Active Lots': '活跃单数',
  Fees: '手续费',
  Margin: '保证金',
  Opens: '开单数',
  'TP Count': '止盈单',
  'TP Amount': '止盈金额',
  'SL Count': '止损单',
  'SL Amount': '止损金额',

  // Positions
  Positions: '持仓',
  Long: '多单',
  Short: '空单',
  None: '暂无',
  Entry: '开仓价',
  Qty: '数量',
  PnL: '盈亏',
  'Long PnL': '多单盈亏',
  'Short PnL': '空单盈亏',

  // Chart
  'Equity Curve': '权益曲线',

  // Log
  Log: '日志',
  Action: '操作',
  Price: '价格',
  Time: '时间',

  // History
  History: '回测历史',
  Refresh: '刷新',
  'No records': '暂无记录',
  'Load failed': '加载失败',
  View: '查看',
  'Failed to get detail': '获取详情失败',
  'Delete this record?': '删除此记录？',
  'Delete failed': '删除失败',
  'No orders': '暂无订单记录',

  // TP/SL labels
  TP: '止盈',
  SL: '止损',
  'open long': '开多',
  'open short': '开空',
  'insufficient equity': '权益不足',
};

const en = {
  subtitle: 'Multi-directional Backtest & Live',
  Live: 'Live',
  Backtest: 'Backtest',
  Connecting: 'Connecting...',
  Connected: 'Connected',
  Disconnected: 'Disconnected, reconnecting in 5s...',

  'Live Config': 'Live Config',
  Simulation: 'Simulation',
  'Real Trading': 'Real Trading',
  Symbol: 'Symbol',
  'Stop Loss %': 'Stop Loss %',
  'Take Profit %': 'Take Profit %',
  'Amount $': 'Amount $',
  Leverage: 'Leverage',
  Interval: 'Interval',
  Direction: 'Direction',
  Both: 'Both',
  'Long Only': 'Long Only',
  'Short Only': 'Short Only',
  'Start Live': 'Start Live',
  'Stop Live': 'Stop Live',
  Mode: 'Mode',
  Sim: 'Sim',
  Real: 'Real',
  Starting: 'Starting...',
  Running: 'Running',
  Stopped: 'Stopped',
  confirm_real: 'Start REAL trading on Binance?',
  'Start REAL trading on Binance?': 'Start REAL trading on Binance?',

  'Backtest Config': 'Backtest Config',
  Days: 'Days',
  'Initial $': 'Initial $',
  Init: 'Init',
  Step: 'Step',
  'Run All': 'Run All',
  Loading: 'Loading...',
  'Init failed': 'Init failed',
  'Step failed': 'Step failed',
  'Run failed': 'Run failed',
  'Request failed': 'Request failed',

  Progress: 'Progress',
  Candles: 'Candles',
  Equity: 'Equity',
  'P&L': 'P&L',
  Return: 'Return',
  'Active Lots': 'Active Lots',
  Fees: 'Fees',
  Margin: 'Margin',
  Opens: 'Opens',
  'TP Count': 'TP Count',
  'TP Amount': 'TP Amount',
  'SL Count': 'SL Count',
  'SL Amount': 'SL Amount',

  Positions: 'Positions',
  Long: 'Long',
  Short: 'Short',
  None: 'None',
  Entry: 'Entry',
  Qty: 'Qty',
  PnL: 'PnL',
  'Long PnL': 'Long PnL',
  'Short PnL': 'Short PnL',

  'Equity Curve': 'Equity Curve',
  Log: 'Log',
  Action: 'Action',
  Price: 'Price',
  Time: 'Time',

  History: 'History',
  Refresh: 'Refresh',
  'No records': 'No records',
  'Load failed': 'Load failed',
  View: 'View',
  'Failed to get detail': 'Failed to get detail',
  'Delete this record?': 'Delete this record?',
  'Delete failed': 'Delete failed',
  'No orders': 'No orders',

  TP: 'TP',
  SL: 'SL',
  'open long': 'open long',
  'open short': 'open short',
  'insufficient equity': 'insufficient equity',
};

const langs = { zh, en };

let currentLang = 'zh';

export function setLang(lang) {
  if (!langs[lang]) lang = 'zh';
  currentLang = lang;
  localStorage.setItem('hermesx_lang', lang);
  applyTranslations();
}

export function t(key) {
  const map = langs[currentLang];
  return map[key] || en[key] || key;
}

export function getLang() {
  return currentLang;
}

export function applyTranslations() {
  // Elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = translation;
    } else {
      el.textContent = translation;
    }
  });

  // Elements with data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  // Radio/label text within data-i18n-group containers
  document.querySelectorAll('[data-i18n-group]').forEach(group => {
    group.querySelectorAll('input[type="radio"]').forEach(radio => {
      const label = group.querySelector(`label[for="${radio.id}"]`) || radio.closest('label');
      if (label) {
        const labelText = label.childNodes[label.childNodes.length - 1];
        if (labelText && labelText.nodeType === Node.TEXT_NODE) {
          labelText.textContent = ' ' + t(radio.value === 'both' ? 'Both' : radio.value === 'long' ? 'Long Only' : 'Short Only');
        }
      }
    });
  });

  // HTML lang attribute
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';

  // Toggle button text
  const toggleBtn = document.getElementById('lang-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = currentLang === 'zh' ? 'EN' : '中';
  }
}

export function initI18n() {
  const saved = localStorage.getItem('hermesx_lang');
  if (saved && langs[saved]) {
    currentLang = saved;
  }
  applyTranslations();
}
