import 'dotenv/config';

/**
 * 策略配置 —— 所有参数集中管理，可通过环境变量覆盖
 */

export interface AppConfig {
  /** Binance 合约 WebSocket 地址 */
  binanceWsUrl: string;
  /** 交易对（大小写敏感，Binance 格式） */
  symbol: string;
  /** 每个账户初始资金（USD） */
  initialBalance: number;
  /** 单次交易使用的保证金比例（0-1） */
  marginRatio: number;
  /** 杠杆倍数 */
  leverage: number;
  /** 开仓/平仓手续费率（Binance 合约通常 0.02%） */
  feeRate: number;
  /** 止损阈值：从最近加仓/开仓价亏损百分比（如 0.03 = 3%） */
  stopLossPercent: number;
  /** 触发加减仓的最小盈亏金额（USD） */
  tradeThreshold: number;
  /** 初始/重置开仓时，每笔交易占余额的比例（如 0.10 = 10%） */
  positionMarginRatio: number;
  /** 加减仓金额模式：'profit'=按盈亏额 | 'fixed'=固定金额 | 'equityPct'=账户权益百分比 */
  positionAmountType: 'profit' | 'fixed' | 'equityPct';
  /** 加减仓金额值：fixed 时为 USD 金额，equityPct 时为百分比（如 10 = 10%） */
  positionAmountValue: number;
  /** 盈亏检查间隔（毫秒） */
  checkIntervalMs: number;
  /** HTTP 服务端口 */
  port: number;
  /** HTTP 监听地址（0.0.0.0 允许局域网访问） */
  host: string;
  /** 是否为离线模拟模式 */
  mockMode: boolean;
  /** Binance API Key（真实交易用） */
  binanceApiKey: string;
  /** Binance API Secret */
  binanceApiSecret: string;
  /** 是否使用币安测试网 */
  binanceTestnet: boolean;
  /** 测试网 API Key */
  binanceTestnetApiKey: string;
  /** 测试网 API Secret */
  binanceTestnetApiSecret: string;
  /** 真实交易 API 基础地址 */
  binanceFapiBase: string;
  /** 测试网 API 基础地址 */
  binanceTestnetBase: string;
}

export const config: AppConfig = {
  binanceWsUrl: process.env.BINANCE_TESTNET === 'true'
    ? 'wss://stream.binancefuture.com/ws'
    : 'wss://fstream.binance.com/ws',
  symbol: process.env.SYMBOL || 'btcusdt',
  initialBalance: 1000,
  marginRatio: 0.8,
  leverage: 3,
  feeRate: 0.0002,
  stopLossPercent: 0.03,
  tradeThreshold: 0.01,
  positionMarginRatio: 0.10, // 初始/加仓用余额的 10% 作为保证金
  positionAmountType: 'profit', // 'profit'=按盈亏额 | 'fixed'=固定金额 | 'equityPct'=权益百分比
  positionAmountValue: 100,     // fixed 时 USD 金额；equityPct 时百分比（10=10%）
  checkIntervalMs: 3000,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  mockMode: process.env.MOCK === 'true',
  binanceApiKey: process.env.BINANCE_API_KEY || '',
  binanceApiSecret: process.env.BINANCE_API_SECRET || '',
  binanceTestnet: process.env.BINANCE_TESTNET === 'true',
  binanceTestnetApiKey: process.env.BINANCE_TESTNET_API_KEY || '',
  binanceTestnetApiSecret: process.env.BINANCE_TESTNET_API_SECRET || '',
  binanceFapiBase: 'https://fapi.binance.com',
  binanceTestnetBase: 'https://testnet.binancefuture.com',
};
