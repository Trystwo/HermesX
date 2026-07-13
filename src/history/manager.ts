/**
 * 历史管理模块 — 保存/列表/详情/删除回测记录
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.join(__dirname, '..', '..', 'output', 'history');

/** 单条历史记录（摘要，用于列表） */
export interface HistoryItem {
  id: string;
  timestamp: number;
  symbol: string;
  days: number;
  leverage: number;
  marginRatio: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  hoursElapsed: number;
  orderCount: number;
  stopCount: number;
}

/** 完整历史记录 */
export interface HistoryDetail extends HistoryItem {
  config: Record<string, unknown>;
  orders: { hour: number; time: string; action: string; price: number; profit: number }[];
  /** 回测结束时未平仓的持仓快照 */
  positions?: { side: string; entryPrice: number; quantity: number; pnl: number; currentPrice: number }[];
}

function ensureDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

/** 生成 ID (时间戳+随机数) */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 保存回测结果到历史 */
export function saveHistory(params: {
  symbol: string;
  days: number;
  leverage: number;
  marginRatio: number;
  summary: { totalReturnPct: number; maxDrawdownPct: number; hoursElapsed: number; stopCount?: number };
  config: Record<string, unknown>;
  orders: HistoryDetail['orders'];
  positions?: HistoryDetail['positions'];
}): string {
  ensureDir();
  const id = genId();
  const item: HistoryDetail = {
    id,
    timestamp: Date.now(),
    symbol: params.symbol,
    days: params.days,
    leverage: params.leverage,
    marginRatio: params.marginRatio,
    totalReturnPct: params.summary.totalReturnPct,
    maxDrawdownPct: params.summary.maxDrawdownPct,
    hoursElapsed: params.summary.hoursElapsed,
    orderCount: params.orders.length,
    stopCount: params.summary.stopCount ?? 0,
    config: params.config,
    orders: params.orders,
    positions: params.positions || [],
  };
  const filePath = path.join(HISTORY_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(item), 'utf-8');
  return id;
}

/** 获取所有历史摘要（按时间倒序） */
export function listHistory(): HistoryItem[] {
  ensureDir();
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
  const items: HistoryItem[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8'));
      items.push({
        id: data.id,
        timestamp: data.timestamp,
        symbol: data.symbol,
        days: data.days,
        leverage: data.leverage,
        marginRatio: data.marginRatio,
        totalReturnPct: data.totalReturnPct,
        maxDrawdownPct: data.maxDrawdownPct,
        hoursElapsed: data.hoursElapsed,
        orderCount: data.orderCount,
        stopCount: data.stopCount,
      });
    } catch { /* skip corrupt files */ }
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}

/** 获取单条历史详情 */
export function getHistory(id: string): HistoryDetail | null {
  const filePath = path.join(HISTORY_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistoryDetail;
  } catch {
    return null;
  }
}

/** 删除一条历史 */
export function deleteHistory(id: string): boolean {
  const filePath = path.join(HISTORY_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
