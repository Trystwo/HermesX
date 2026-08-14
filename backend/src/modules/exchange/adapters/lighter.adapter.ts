import { Logger } from '@nestjs/common';
import {
  AccountApi,
  AccountByEnum,
  Configuration,
  OrderApi,
  SignerClient,
} from 'zklighter-sdk';
import { Environment } from '../../../common/constants/enums';
import type { ExchangeAdapter } from './exchange-adapter';
import type {
  BalanceInfo,
  ConnectionTestResult,
  OpenOrderInfo,
  OrderResult,
  PlaceOrderParams,
  PositionInfo,
  PositionSideParam,
  TickerInfo,
} from '../exchange.types';

const MAINNET_URL = 'https://mainnet.zklighter.elliot.ai';
const TESTNET_URL = 'https://testnet.zklighter.elliot.ai';

interface MarketMeta {
  marketId: number;
  symbol: string;
  sizeDecimals: number;
  priceDecimals: number;
  lastTradePrice: number;
}

/**
 * Lighter 适配器：净持仓模型，无 hedge mode。
 * 对冲由上层绑定两个子账户分别开多/开空完成。
 */
export class LighterAdapter implements ExchangeAdapter {
  readonly exchangeName = 'LIGHTER';
  readonly supportsHedgeMode = false;
  private readonly logger = new Logger(LighterAdapter.name);
  private readonly baseUrl: string;
  private readonly signer: SignerClient;
  private readonly accountApi: AccountApi;
  private readonly orderApi: OrderApi;
  private readonly accountIndex: number;
  private readonly apiKeyIndex: number;
  private marketCache: MarketMeta[] | null = null;
  private marketCacheAt = 0;

  constructor(
    readonly apiConfigId: string,
    readonly environment: string,
    privateKey: string,
    accountIndex: number,
    apiKeyIndex: number,
  ) {
    this.baseUrl =
      environment === Environment.TESTNET ? TESTNET_URL : MAINNET_URL;
    this.accountIndex = accountIndex;
    this.apiKeyIndex = apiKeyIndex;
    this.signer = new SignerClient(
      this.baseUrl,
      privateKey,
      apiKeyIndex,
      accountIndex,
    );
    const cfg = new Configuration({ basePath: this.baseUrl });
    this.accountApi = new AccountApi(cfg);
    this.orderApi = new OrderApi(cfg);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const err = this.signer.check_client();
      if (err) {
        return { ok: false, latencyMs: Date.now() - start, message: err };
      }
      await this.fetchAccount();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: (e as Error).message,
      };
    }
  }

  private preferredMarginMode = SignerClient.CROSS_MARGIN_MODE;
  private preferredLeverage = 10;

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (!Number.isFinite(leverage) || leverage < 1) {
      throw new Error(`Invalid leverage: ${leverage}`);
    }
    this.preferredLeverage = Math.floor(leverage);
    await this.applyLeverageAndMargin(symbol);
  }

  async setMarginMode(
    symbol: string,
    marginMode: 'ISOLATED' | 'CROSSED',
  ): Promise<void> {
    this.preferredMarginMode =
      marginMode === 'ISOLATED'
        ? SignerClient.ISOLATED_MARGIN_MODE
        : SignerClient.CROSS_MARGIN_MODE;
    // 必须带上当前目标杠杆，否则会把杠杆打回默认 10x
    await this.applyLeverageAndMargin(symbol);
  }

  async setPositionMode(_dualSide: boolean): Promise<void> {
    // Lighter 无双向持仓模式
  }

  private async applyLeverageAndMargin(symbol: string): Promise<void> {
    const market = await this.resolveMarket(symbol);
    const [txHash, , err] = await this.signer.update_leverage(
      market.marketId,
      this.preferredMarginMode,
      this.preferredLeverage,
    );
    if (err) {
      this.logger.warn(
        `Lighter update_leverage failed (lev=${this.preferredLeverage}, mode=${this.preferredMarginMode}): ${err}`,
      );
      return;
    }
    this.logger.log(
      `Lighter set leverage ${this.preferredLeverage}x mode=${this.preferredMarginMode} market=${market.marketId} tx=${txHash}`,
    );
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const market = await this.resolveMarket(params.symbol);
    const isAsk = params.side === 'SELL';
    const baseAmount = this.toBaseAmount(params.quantity, market.sizeDecimals);
    const clientOrderIndex = this.nextClientOrderIndex();
    const reduceOnly = !!params.reduceOnly;

    if (baseAmount <= 0) {
      throw new Error(
        `Lighter base_amount invalid for qty=${params.quantity} decimals=${market.sizeDecimals}`,
      );
    }

    let order: any;
    let tx: any;
    let err: string | null;

    if (params.type === 'MARKET') {
      const ticker = await this.fetchTicker(params.symbol);
      const ref = ticker.lastPrice || market.lastTradePrice;
      // 最差可接受价：买入上浮 / 卖出下调 1%
      const worst =
        ref * (isAsk ? 0.99 : 1.01);
      const avgPrice = this.toPriceInt(worst, market.priceDecimals);
      [order, tx, err] = await this.signer.create_market_order(
        market.marketId,
        clientOrderIndex,
        baseAmount,
        avgPrice,
        isAsk,
        reduceOnly,
      );
    } else if (
      params.type === 'TAKE_PROFIT_MARKET' ||
      params.type === 'STOP_MARKET'
    ) {
      if (params.stopPrice == null || params.stopPrice <= 0) {
        throw new Error('Lighter TP/SL requires stopPrice');
      }
      const trigger = this.toPriceInt(params.stopPrice, market.priceDecimals);
      // 触发后市价滑点保护：TP/SL 允许 2% 滑点
      const slipMult = isAsk ? 0.98 : 1.02;
      const execPrice = this.toPriceInt(
        params.stopPrice * slipMult,
        market.priceDecimals,
      );
      if (params.type === 'TAKE_PROFIT_MARKET') {
        [order, tx, err] = await this.signer.create_tp_order(
          market.marketId,
          clientOrderIndex,
          baseAmount,
          trigger,
          execPrice,
          isAsk,
          reduceOnly,
        );
      } else {
        [order, tx, err] = await this.signer.create_sl_order(
          market.marketId,
          clientOrderIndex,
          baseAmount,
          trigger,
          execPrice,
          isAsk,
          reduceOnly,
        );
      }
    } else if (params.type === 'LIMIT') {
      if (params.price == null) {
        throw new Error('Lighter LIMIT requires price');
      }
      const price = this.toPriceInt(params.price, market.priceDecimals);
      [order, tx, err] = await this.signer.create_order(
        market.marketId,
        clientOrderIndex,
        baseAmount,
        price,
        isAsk,
        SignerClient.ORDER_TYPE_LIMIT,
        SignerClient.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME,
        reduceOnly,
      );
    } else {
      throw new Error(`Unsupported Lighter order type: ${params.type}`);
    }

    if (err) {
      throw new Error(`Lighter placeOrder failed: ${err}`);
    }

    // create_* 返回的是签名 tx，没有交易所分配的 order_index；
    // 本地先记 client_order_index，条件单再尽量反查真实 order_index（撤单/对账都依赖它）。
    let orderId = String(
      order?.order_index ??
        order?.OrderIndex ??
        order?.ClientOrderIndex ??
        order?.client_order_index ??
        clientOrderIndex,
    );

    if (params.type !== 'MARKET') {
      try {
        const open = await this.fetchOpenOrders(params.symbol);
        const matched = open.find(
          (o) =>
            o.clientOrderId === String(clientOrderIndex) ||
            o.clientOrderId === orderId ||
            o.id === orderId,
        );
        if (matched?.id) {
          orderId = matched.id;
        }
      } catch (e) {
        this.logger.warn(
          `Lighter resolve order_index failed, keep clientOrderIndex=${clientOrderIndex}: ${(e as Error).message}`,
        );
      }
    }

    // 市价单尽量用 ticker 作为均价占位；后续 resolveFillPrice 可再校正
    let avgPrice: number | undefined;
    if (params.type === 'MARKET') {
      try {
        const t = await this.fetchTicker(params.symbol);
        avgPrice = t.lastPrice > 0 ? t.lastPrice : undefined;
      } catch {
        /* ignore */
      }
    }

    return {
      id: orderId,
      status: params.type === 'MARKET' ? 'closed' : 'open',
      filledQty: params.type === 'MARKET' ? params.quantity : 0,
      avgPrice,
      raw: { order, tx, clientOrderIndex, marketId: market.marketId },
    };
  }

  async fetchOrder(orderId: string, symbol: string): Promise<OrderResult> {
    const open = await this.fetchOpenOrders(symbol);
    const found = open.find((o) => o.id === orderId);
    if (found) {
      return {
        id: found.id,
        status: found.status,
        filledQty: found.filled,
        avgPrice: found.price,
        raw: found.raw,
      };
    }
    // 不在挂单列表视为已成交/取消
    return {
      id: orderId,
      status: 'closed',
      filledQty: 0,
      raw: null,
    };
  }

  async fetchOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const auth = this.getAuthToken();
    if (symbol) {
      const market = await this.resolveMarket(symbol);
      const res = await this.orderApi.accountActiveOrders(
        this.accountIndex,
        market.marketId,
        undefined,
        auth,
      );
      return this.mapOrders(res.data?.orders ?? [], symbol);
    }

    // 无 symbol 时拉全部活跃市场的挂单（有限市场列表）
    const markets = await this.loadMarkets();
    const all: OpenOrderInfo[] = [];
    for (const m of markets.slice(0, 30)) {
      try {
        const res = await this.orderApi.accountActiveOrders(
          this.accountIndex,
          m.marketId,
          undefined,
          auth,
        );
        all.push(...this.mapOrders(res.data?.orders ?? [], m.symbol));
      } catch {
        /* skip market */
      }
    }
    return all;
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    const market = await this.resolveMarket(symbol);
    const tryCancel = async (index: bigint) => {
      const [, , err] = await this.signer.cancel_order(market.marketId, index);
      if (!err) return true;
      const lower = err.toLowerCase();
      if (
        lower.includes('not found') ||
        lower.includes('does not exist') ||
        lower.includes('already')
      ) {
        return true;
      }
      throw new Error(`Lighter cancelOrder failed: ${err}`);
    };

    const resolveIndex = async (): Promise<bigint> => {
      if (/^\d+$/.test(orderId)) {
        return BigInt(orderId);
      }
      // 历史可能存 tx_hash / client_order_index
      const open = await this.fetchOpenOrders(symbol);
      const matched = open.find(
        (o) => o.id === orderId || o.clientOrderId === orderId,
      );
      if (!matched?.id || !/^\d+$/.test(matched.id)) {
        throw new Error(
          `Lighter cancelOrder: cannot resolve order_index for id=${orderId}`,
        );
      }
      return BigInt(matched.id);
    };

    try {
      const index = await resolveIndex();
      await tryCancel(index);
    } catch (e) {
      if (!/^\d+$/.test(orderId)) throw e;
      // 数字 id 直接撤失败时，再按 client_order_index 反查
      const open = await this.fetchOpenOrders(symbol);
      const matched = open.find(
        (o) => o.id === orderId || o.clientOrderId === orderId,
      );
      if (!matched?.id) throw e;
      await tryCancel(BigInt(matched.id));
    }
  }

  async closePosition(
    symbol: string,
    side: PositionSideParam,
    quantity: number,
  ): Promise<OrderResult> {
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    return this.placeOrder({
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity,
      reduceOnly: true,
    });
  }

  async fetchPositions(symbols?: string[]): Promise<PositionInfo[]> {
    const account = await this.fetchAccount();
    const positions = account.positions ?? [];
    const wanted = symbols?.map((s) => this.normalizeSymbol(s));

    return positions
      .filter((p) => {
        const size = Math.abs(Number(p.position) || 0);
        if (size <= 0) return false;
        if (!wanted?.length) return true;
        const sym = this.normalizeSymbol(p.symbol);
        return wanted.some(
          (w) =>
            w === sym ||
            w.startsWith(sym) ||
            sym.startsWith(w.replace(/USDT$|USDC$/i, '')),
        );
      })
      .map((p) => {
        const sign = Number(p.sign) || 0;
        const size = Math.abs(Number(p.position) || 0);
        return {
          symbol: p.symbol,
          side: sign >= 0 ? ('LONG' as const) : ('SHORT' as const),
          contracts: size,
          entryPrice: Number(p.avg_entry_price) || 0,
          unrealizedPnl: Number(p.unrealized_pnl) || 0,
          leverage: 0,
          marginMode:
            p.margin_mode === SignerClient.ISOLATED_MARGIN_MODE
              ? 'isolated'
              : 'cross',
          liquidationPrice: Number(p.liquidation_price) || undefined,
        };
      });
  }

  async fetchBalance(_opts?: {
    symbol?: string;
    currency?: string;
  }): Promise<BalanceInfo> {
    const account = await this.fetchAccount();
    const available = Number(account.available_balance) || 0;
    const collateral = Number(account.collateral) || available;
    return {
      total: collateral,
      free: available,
      used: Math.max(0, collateral - available),
      currency: 'USDC',
    };
  }

  async fetchTicker(symbol: string): Promise<TickerInfo> {
    const market = await this.resolveMarket(symbol);
    // 刷新详情拿 last_trade_price
    try {
      const details = await this.orderApi.orderBookDetails(market.marketId);
      const d = details.data?.order_book_details?.[0];
      if (d) {
        const last = Number(d.last_trade_price) || market.lastTradePrice;
        return {
          symbol,
          lastPrice: last,
          bid: last,
          ask: last,
          timestamp: Date.now(),
        };
      }
    } catch (e) {
      this.logger.warn(
        `Lighter orderBookDetails failed: ${(e as Error).message}`,
      );
    }
    return {
      symbol,
      lastPrice: market.lastTradePrice,
      bid: market.lastTradePrice,
      ask: market.lastTradePrice,
      timestamp: Date.now(),
    };
  }

  destroy(): void {
    void this.signer.close();
  }

  // ── internals ──

  private getAuthToken(): string {
    const [token, err] = this.signer.create_auth_token_with_expiry(
      SignerClient.DEFAULT_10_MIN_AUTH_EXPIRY,
    );
    if (err || !token) {
      throw new Error(`Lighter auth token failed: ${err ?? 'empty'}`);
    }
    return token;
  }

  private async fetchAccount() {
    const res = await this.accountApi.account(
      AccountByEnum.Index,
      String(this.accountIndex),
    );
    const account = res.data?.accounts?.[0];
    if (!account) {
      throw new Error(
        `Lighter account not found for index=${this.accountIndex}`,
      );
    }
    return account;
  }

  private async loadMarkets(): Promise<MarketMeta[]> {
    const now = Date.now();
    if (this.marketCache && now - this.marketCacheAt < 60_000) {
      return this.marketCache;
    }
    const res = await this.orderApi.orderBookDetails();
    const details = res.data?.order_book_details ?? [];
    this.marketCache = details.map((d) => ({
      marketId: d.market_id,
      symbol: d.symbol,
      sizeDecimals: d.size_decimals ?? d.supported_size_decimals ?? 4,
      priceDecimals: d.price_decimals ?? d.supported_price_decimals ?? 2,
      lastTradePrice: Number(d.last_trade_price) || 0,
    }));
    this.marketCacheAt = now;
    return this.marketCache;
  }

  private async resolveMarket(symbol: string): Promise<MarketMeta> {
    const markets = await this.loadMarkets();
    const norm = this.normalizeSymbol(symbol);
    const base = norm.replace(/USDT$|USDC$|USD$/i, '');

    const found =
      markets.find((m) => this.normalizeSymbol(m.symbol) === norm) ||
      markets.find((m) => this.normalizeSymbol(m.symbol) === base) ||
      markets.find((m) => this.normalizeSymbol(m.symbol).startsWith(base));

    if (!found) {
      throw new Error(`Lighter market not found for symbol=${symbol}`);
    }
    return found;
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace(/[:/]/g, '').toUpperCase();
  }

  private toBaseAmount(qty: number, sizeDecimals: number): number {
    return Math.round(qty * Math.pow(10, sizeDecimals));
  }

  private toPriceInt(price: number, priceDecimals: number): number {
    return Math.round(price * Math.pow(10, priceDecimals));
  }

  private nextClientOrderIndex(): number {
    // uint48 范围；用时间低位 + 随机避免冲突
    return Number(BigInt(Date.now()) % 2000000000000n) + Math.floor(Math.random() * 1000);
  }

  /** Lighter 常见返回秒级 unix；统一成 ms，避免前端显示成 1970 */
  private normalizeTimestampMs(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return Date.now();
    if (n < 1e12) return Math.round(n * 1000); // seconds
    if (n < 1e14) return Math.round(n); // milliseconds
    return Math.round(n / 1000); // microseconds
  }

  private mapOrders(orders: any[], symbol: string): OpenOrderInfo[] {
    return (orders || []).map((o) => {
      const type = String(o.type ?? '').toLowerCase();
      let mappedType = type;
      if (type.includes('take_profit') || type === 'tp') {
        mappedType = 'take_profit_market';
      } else if (type.includes('stop_loss') || type === 'sl') {
        mappedType = 'stop_market';
      }
      const ts = this.normalizeTimestampMs(
        o.timestamp ?? o.created_at ?? o.updated_at,
      );
      const clientOrderId =
        o.client_order_index != null && String(o.client_order_index) !== ''
          ? String(o.client_order_index)
          : o.client_order_id != null && String(o.client_order_id) !== ''
            ? String(o.client_order_id)
            : undefined;
      // 净持仓账户：reduce-only 卖≈平多，reduce-only 买≈平空
      const positionSide = o.reduce_only
        ? o.is_ask
          ? 'LONG'
          : 'SHORT'
        : undefined;
      return {
        id: String(o.order_index ?? o.order_id ?? ''),
        symbol,
        type: mappedType,
        side: o.is_ask ? 'sell' : 'buy',
        status: String(o.status ?? 'open').toLowerCase(),
        price: o.price != null ? Number(o.price) : undefined,
        stopPrice:
          o.trigger_price != null && Number(o.trigger_price) > 0
            ? Number(o.trigger_price)
            : undefined,
        amount: Number(o.initial_base_amount ?? o.base_size ?? 0),
        filled: Number(o.filled_base_amount ?? 0),
        timestamp: ts,
        datetime: new Date(ts).toISOString(),
        clientOrderId,
        positionSide,
        reduceOnly: !!o.reduce_only,
        apiConfigId: this.apiConfigId,
        raw: o,
      } satisfies OpenOrderInfo;
    });
  }
}

export function lighterBaseUrl(environment: string): string {
  return environment === Environment.TESTNET ? TESTNET_URL : MAINNET_URL;
}

export async function testLighterConnection(opts: {
  privateKey: string;
  accountIndex: number;
  apiKeyIndex: number;
  environment: string;
}): Promise<ConnectionTestResult> {
  const adapter = new LighterAdapter(
    'test',
    opts.environment,
    opts.privateKey,
    opts.accountIndex,
    opts.apiKeyIndex,
  );
  try {
    return await adapter.testConnection();
  } finally {
    adapter.destroy();
  }
}
