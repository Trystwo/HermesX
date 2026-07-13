package strategy

import (
	"context"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"strings"

	"hermesx/internal/account"
	"hermesx/internal/exchange"
	"hermesx/internal/market"
)

const maxSnapshots = 2000
const feeRate = 0.0002

type EngineConfig struct {
	Symbol              string  `json:"symbol"`
	InitialBalance      float64 `json:"initialBalance"`
	Leverage            int     `json:"leverage"`
	MarginRatio         float64 `json:"marginRatio"`
	StopLossPercent     float64 `json:"stopLossPercent"`
	TakeProfitPercent   float64 `json:"takeProfitPercent"`
	PositionAmountValue float64 `json:"positionAmountValue"`
	Interval            string  `json:"interval"`
	Mode                string  `json:"mode"`
	Direction           string  `json:"direction"`
	BinanceAPIKey       string  `json:"-"`
	BinanceAPISecret    string  `json:"-"`
	BinanceTestnet      bool    `json:"-"`
	TestnetAPIKey       string  `json:"-"`
	TestnetSecret       string  `json:"-"`
}

type Snapshot struct {
	Hour           int                  `json:"hour"`
	Timestamp      int64                `json:"timestamp"`
	OpenPrice      float64              `json:"openPrice"`
	Equity         float64              `json:"equity"`
	Balance        float64              `json:"balance"`
	UnrealizedPnL  float64              `json:"unrealizedPnL"`
	LongPnL        float64              `json:"longPnL"`
	ShortPnL       float64              `json:"shortPnL"`
	TotalReturnPct float64              `json:"totalReturnPct"`
	LongLots       []account.Lot        `json:"longLots"`
	ShortLots      []account.Lot        `json:"shortLots"`
	StoppedLots    []account.StoppedLot `json:"stoppedLots"`
	Action         string               `json:"action"`
}

type LiveState struct {
	Config         EngineConfig `json:"config"`
	Running        bool         `json:"running"`
	StartTime      int64        `json:"startTime"`
	Balance        float64      `json:"balance"`
	LongLots       []account.Lot `json:"longLots"`
	ShortLots      []account.Lot `json:"shortLots"`
	Snapshots      []Snapshot   `json:"snapshots"`
	TotalFee       float64      `json:"totalFee"`
	TotalOpenCount int          `json:"totalOpenCount"`
	CurrentHour    int64        `json:"currentHour"`
	LastPrice      float64      `json:"lastPrice"`
	LogEntries     []string     `json:"logEntries"`
}

type Engine struct {
	cfg     EngineConfig
	acct    *account.Account
	mkt     market.Market
	trade   *exchange.Client

	stateMu sync.RWMutex
	state   LiveState

	broadcastFn func(LiveState)

	lastCheckedHour int64
	hedgeMode       bool

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func NewEngine(cfg EngineConfig, m market.Market) *Engine {
	e := &Engine{
		cfg:   cfg,
		acct:  account.New(cfg.InitialBalance),
		mkt:   m,
		state: LiveState{Config: cfg},
	}

	// Real mode: production exchange client
	if cfg.Mode == "real" && cfg.BinanceAPIKey != "" {
		e.trade = exchange.NewClient(
			"https://fapi.binance.com",
			cfg.BinanceAPIKey, cfg.BinanceAPISecret,
		)
	}

	// Sim mode with testnet keys: testnet client
	if cfg.Mode == "sim" && cfg.BinanceTestnet && cfg.TestnetAPIKey != "" {
		log.Printf("[engine] testnet mode enabled, api key: %s...", cfg.TestnetAPIKey[:8])
		e.trade = exchange.NewClient(
			"https://testnet.binancefuture.com",
			cfg.TestnetAPIKey, cfg.TestnetSecret,
		)
		e.trade.QuantityPrecision = 4
		e.trade.PricePrecision = 2
	} else {
		log.Printf("[engine] sim mode (testnet=%v, hasKey=%v)", cfg.BinanceTestnet, cfg.TestnetAPIKey != "")
	}

	return e
}

func (e *Engine) SetBroadcast(fn func(LiveState)) {
	e.broadcastFn = fn
}

func (e *Engine) State() LiveState {
	e.stateMu.RLock()
	defer e.stateMu.RUnlock()
	return cloneState(e.state)
}

// GetExchangeBalance fetches real balance from Binance (testnet/prod).
// Returns 0 if no exchange client is configured.
func (e *Engine) GetExchangeBalance() float64 {
	if e.trade == nil {
		return 0
	}
	bal, err := e.trade.GetBalance(context.Background())
	if err != nil {
		return 0
	}
	return bal.AvailableBalance
}

func (e *Engine) Run(ctx context.Context) {
	e.ctx, e.cancel = context.WithCancel(ctx)
	defer e.wg.Done()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-e.ctx.Done():
			return

		case update := <-e.mkt.PriceChan():
			e.stateMu.Lock()
			e.state.LastPrice = update.Price
			e.stateMu.Unlock()

			if e.state.Running {
				e.checkHourBoundary(update.Price, update.Time)
			}

		case candle := <-e.mkt.CandleChan():
			if e.state.Running {
				e.processNewHour(candle.Open, candle.OpenTime)
			}

		case <-ticker.C:
			if e.state.Running {
				e.checkStopLoss()
				e.broadcastState()
			}
		}
	}
}

func (e *Engine) Start(currentPrice float64, currentHour int64) {
	e.stateMu.Lock()
	if currentPrice <= 0 {
		currentPrice = e.mkt.CurrentPrice()
		if currentPrice <= 0 {
			currentPrice = e.state.LastPrice
		}
	}
	if currentHour <= 0 {
		currentHour = getHourTimestamp(time.Now().UnixMilli(), e.cfg.Interval)
	}
	defer e.stateMu.Unlock()

	if e.state.Running {
		return
	}
	e.state.Running = true
	e.state.StartTime = time.Now().UnixMilli()
	e.state.LastPrice = currentPrice
	e.state.CurrentHour = currentHour
	e.lastCheckedHour = currentHour

	// Use real exchange balance if available (testnet/prod)
	if e.trade != nil {
		bal, err := e.trade.GetBalance(context.Background())
		if err == nil && bal.AvailableBalance > 0 {
			e.cfg.InitialBalance = bal.AvailableBalance
			e.state.Config.InitialBalance = bal.AvailableBalance
			e.state.Balance = bal.AvailableBalance
			e.logf("exchange balance: $%.2f", bal.AvailableBalance)
		} else {
			e.state.Balance = e.cfg.InitialBalance
			if err != nil {
				e.logf("get balance error: %v, using config $%.2f", err, e.cfg.InitialBalance)
			}
		}
	} else {
		e.state.Balance = e.cfg.InitialBalance
	}

	e.log("engine started")
	e.logf("initial price: $%.2f", currentPrice)
	e.logf("mode: %s", e.cfg.Mode)
	if e.trade != nil {
		sym := strings.ToUpper(e.cfg.Symbol)
		ctx := context.Background()
		if err := e.trade.SetHedgeMode(ctx); err != nil {
			e.logf("hedge mode failed: %v, using one-way mode", err)
			e.hedgeMode = false
		} else {
			e.hedgeMode = true
			e.log("hedge mode enabled")
		}
		if err := e.trade.SetLeverage(ctx, sym, e.cfg.Leverage); err != nil {
			e.logf("set leverage err: %v", err)
		}
	}

	e.stateMu.Unlock()
	e.processNewHour(currentPrice, currentHour)
	e.stateMu.Lock()
}

func (e *Engine) Stop() {
	e.stateMu.Lock()
	if !e.state.Running {
		e.stateMu.Unlock()
		return
	}

	// Close all open positions via exchange
	if e.trade != nil && (len(e.state.LongLots) > 0 || len(e.state.ShortLots) > 0) {
		ctx := context.Background()
		sym := strings.ToUpper(e.cfg.Symbol)
		for _, l := range e.state.LongLots {
			closePosSide := ""
			if e.hedgeMode { closePosSide = "LONG" }
			e.trade.MarketClose(ctx, "SELL", l.Quantity, closePosSide, sym)
		}
		for _, l := range e.state.ShortLots {
			closePosSide := ""
			if e.hedgeMode { closePosSide = "SHORT" }
			e.trade.MarketClose(ctx, "BUY", l.Quantity, closePosSide, sym)
		}
		// Sync balance from exchange
		if bal, err := e.trade.GetBalance(ctx); err == nil {
			e.state.Balance = bal.AvailableBalance
			e.cfg.InitialBalance = bal.AvailableBalance
			e.state.Config.InitialBalance = bal.AvailableBalance
		}
		e.state.LongLots = nil
		e.state.ShortLots = nil
		e.logf("closed all positions, balance: $%.2f", e.state.Balance)
	}

	e.state.Running = false
	e.log("engine stopped")
	e.broadcastStateLocked()
	e.stateMu.Unlock()
}

func (e *Engine) UpdateConfig(cfg EngineConfig) {
	e.stateMu.Lock()
	defer e.stateMu.Unlock()
	e.cfg = cfg
	e.state.Config = cfg
}

func (e *Engine) checkHourBoundary(price float64, nowMs int64) {
	hourTs := getHourTimestamp(nowMs, e.cfg.Interval)
	if hourTs != e.lastCheckedHour && hourTs != e.state.CurrentHour {
		e.lastCheckedHour = hourTs
		e.processNewHour(price, hourTs)
	}
}

func (e *Engine) processNewHour(price float64, hourTs int64) {
	e.stateMu.Lock()
	defer e.stateMu.Unlock()

	cfg := e.cfg

	// Create a snapshot of current lots
	acct := account.New(e.state.Balance)
	acct.LongLots = cloneLots(e.state.LongLots)
	acct.ShortLots = cloneLots(e.state.ShortLots)

	// Check close conditions
	stoppedLots := acct.CheckCloseConditions(price, price, feeRate)
	closeFee := 0.0
	for _, sl := range stoppedLots {
		closeFee += sl.Fee
	}

	actionParts := make([]string, 0)
	if slCount := countReason(stoppedLots, "sl"); slCount > 0 {
		actionParts = append(actionParts, fmtCount(slCount, "stop"))
	}
	if tpCount := countReason(stoppedLots, "tp"); tpCount > 0 {
		actionParts = append(actionParts, fmtCount(tpCount, "tp"))
	}

	// Open new lots
	equity := acct.Equity(price)
	available := acct.Balance + acct.UnrealizedPnL(price)
	marginPerSide := cfg.PositionAmountValue
	dir := cfg.Direction
	sides := 2
	if dir != "both" {
		sides = 1
	}

	openFee := 0.0
	didOpen := false
	useTrade := e.trade != nil && equity > 0 && available >= marginPerSide*float64(sides)
	if useTrade {
		qty := (marginPerSide * float64(cfg.Leverage)) / price
		sym := strings.ToUpper(cfg.Symbol)
		e.logf("trade: qty=%.6f notional=%.2f price=%.2f", qty, qty*price, price)

		posSideLong := ""
		posSideShort := ""
		if e.hedgeMode {
			posSideLong = "LONG"
			posSideShort = "SHORT"
		}

		e.stateMu.Unlock()
		if dir == "both" || dir == "long" {
			r, err := e.trade.MarketOpen(context.Background(), "BUY", qty, posSideLong, sym)
			if err != nil {
				e.logf("trade open long error: %v", err)
			} else {
				actionParts = append(actionParts, "open long")
				entryPx := r.AvgPrice
				if entryPx <= 0 { entryPx = price }
				acct.OpenLong(entryPx, marginPerSide, float64(cfg.Leverage), feeRate, cfg.StopLossPercent, cfg.TakeProfitPercent)
				openFee += marginPerSide * feeRate
				didOpen = true
				e.logf("trade open long ok: avg=%f execQty=%f", r.AvgPrice, r.ExecutedQty)
			}
		}
		if dir == "both" || dir == "short" {
			r, err := e.trade.MarketOpen(context.Background(), "SELL", qty, posSideShort, sym)
			if err != nil {
				e.logf("trade open short error: %v", err)
			} else {
				actionParts = append(actionParts, "open short")
				entryPx := r.AvgPrice
				if entryPx <= 0 { entryPx = price }
				acct.OpenShort(entryPx, marginPerSide, float64(cfg.Leverage), feeRate, cfg.StopLossPercent, cfg.TakeProfitPercent)
				openFee += marginPerSide * feeRate
				didOpen = true
				e.logf("trade open short ok: avg=%f execQty=%f", r.AvgPrice, r.ExecutedQty)
			}
		}
		e.stateMu.Lock()
	} else if equity > 0 && available >= marginPerSide*float64(sides) {
		posValue := marginPerSide * float64(cfg.Leverage)

		if dir == "both" || dir == "long" {
			actionParts = append(actionParts, "open long")
			acct.OpenLong(price, marginPerSide, float64(cfg.Leverage), feeRate, cfg.StopLossPercent, cfg.TakeProfitPercent)
			openFee += posValue * feeRate
		}
		if dir == "both" || dir == "short" {
			actionParts = append(actionParts, "open short")
			acct.OpenShort(price, marginPerSide, float64(cfg.Leverage), feeRate, cfg.StopLossPercent, cfg.TakeProfitPercent)
			openFee += posValue * feeRate
		}
		didOpen = true
	} else {
		actionParts = append(actionParts, "insufficient equity")
	}

	action := joinAction(actionParts)

	snap := makeSnapshot(
		len(e.state.Snapshots), price, hourTs, acct, stoppedLots, action, cfg.InitialBalance,
	)

	e.state.Balance = acct.Balance
	e.state.LongLots = acct.LongLots
	e.state.ShortLots = acct.ShortLots
	e.state.Snapshots = append(e.state.Snapshots, snap)
	if len(e.state.Snapshots) > maxSnapshots {
		e.state.Snapshots = e.state.Snapshots[len(e.state.Snapshots)-maxSnapshots:]
	}
	e.state.TotalFee += openFee + closeFee
	if didOpen {
		e.state.TotalOpenCount++
	}
	e.state.CurrentHour = hourTs

	e.logf("[%s] %s @ $%.2f", time.UnixMilli(hourTs).UTC().Format("15:04"), action, price)
	e.broadcastStateLocked()
}

func (e *Engine) checkStopLoss() {
	e.stateMu.Lock()

	if len(e.state.LongLots) == 0 && len(e.state.ShortLots) == 0 {
		e.stateMu.Unlock()
		return
	}

	price := e.state.LastPrice
	longLots := cloneLots(e.state.LongLots)
	shortLots := cloneLots(e.state.ShortLots)
	balance := e.state.Balance
	cfg := e.cfg

	// Check close conditions locally first
	acct := account.New(balance)
	acct.LongLots = longLots
	acct.ShortLots = shortLots
	stoppedLots := acct.CheckCloseConditions(price, price, feeRate)
	e.stateMu.Unlock()

	if len(stoppedLots) == 0 {
		return
	}

	// If we have a trade client, close positions via exchange
	if e.trade != nil {
		ctx := context.Background()
		sym := strings.ToUpper(cfg.Symbol)
		for _, sl := range stoppedLots {
			if sl.Quantity <= 0 { continue }
			side := "SELL"
			if sl.Side == "short" { side = "BUY" }
			closePosSide := ""
			if e.hedgeMode {
				closePosSide = "LONG"
				if sl.Side == "short" { closePosSide = "SHORT" }
			}
			if _, err := e.trade.MarketClose(ctx, side, sl.Quantity, closePosSide, sym); err != nil {
				e.logf("trade close %s error: %v", sl.Side, err)
			}
		}
		if bal, err := e.trade.GetBalance(ctx); err == nil {
			e.stateMu.Lock()
			e.state.Balance = bal.AvailableBalance
			e.stateMu.Unlock()
		}
	}

	closeFee := 0.0
	for _, sl := range stoppedLots {
		closeFee += sl.Fee
	}

	parts := make([]string, 0)
	if sl := countReason(stoppedLots, "sl"); sl > 0 {
		parts = append(parts, fmtCount(sl, "sl"))
	}
	if tp := countReason(stoppedLots, "tp"); tp > 0 {
		parts = append(parts, fmtCount(tp, "tp"))
	}

	e.stateMu.Lock()
	snap := makeSnapshot(
		len(e.state.Snapshots), price, time.Now().UnixMilli(), acct, stoppedLots,
		joinAction(parts), cfg.InitialBalance,
	)

	e.state.Balance = acct.Balance
	e.state.LongLots = acct.LongLots
	e.state.ShortLots = acct.ShortLots
	e.state.Snapshots = append(e.state.Snapshots, snap)
	if len(e.state.Snapshots) > maxSnapshots {
		e.state.Snapshots = e.state.Snapshots[len(e.state.Snapshots)-maxSnapshots:]
	}
	e.state.TotalFee += closeFee

	e.logf("[tick] %s @ $%.2f", joinAction(parts), price)
	e.broadcastStateLocked()
}

func (e *Engine) broadcastState() {
	e.stateMu.RLock()
	defer e.stateMu.RUnlock()
	e.broadcastStateLocked()
}

func (e *Engine) broadcastStateLocked() {
	if e.broadcastFn == nil {
		return
	}
	price := e.state.LastPrice
	longPnL := 0.0
	for _, l := range e.state.LongLots {
		longPnL += (price - l.EntryPrice) * l.Quantity
	}
	shortPnL := 0.0
	for _, l := range e.state.ShortLots {
		shortPnL += (l.EntryPrice - price) * l.Quantity
	}
	totalMargin := 0.0
	for _, l := range e.state.LongLots { totalMargin += l.Margin }
	for _, l := range e.state.ShortLots { totalMargin += l.Margin }
	totalEquity := e.state.Balance + totalMargin + longPnL + shortPnL

	state := e.state
	state.Snapshots = append([]Snapshot(nil), e.state.Snapshots...)
	state.Snapshots = append(state.Snapshots, Snapshot{
		Hour:           len(e.state.Snapshots),
		Timestamp:      time.Now().UnixMilli(),
		OpenPrice:      price,
		Equity:         round2(totalEquity),
		Balance:        round2(e.state.Balance),
		UnrealizedPnL:  round2(longPnL + shortPnL),
		LongPnL:        round2(longPnL),
		ShortPnL:       round2(shortPnL),
		TotalReturnPct: round2((totalEquity - e.cfg.InitialBalance) / e.cfg.InitialBalance * 100),
		LongLots:       cloneLots(e.state.LongLots),
		ShortLots:      cloneLots(e.state.ShortLots),
	})
	e.broadcastFn(state)
}

func (e *Engine) log(msg string) {
	e.state.LogEntries = append(e.state.LogEntries, msg)
	if len(e.state.LogEntries) > 500 {
		e.state.LogEntries = e.state.LogEntries[len(e.state.LogEntries)-500:]
	}
	log.Println(msg)
}

func (e *Engine) logf(format string, args ...interface{}) {
	e.log(fmt.Sprintf(format, args...))
}

func getHourTimestamp(ms int64, interval string) int64 {
	minutes := map[string]int{
		"1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
		"1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720, "1d": 1440,
	}[interval]
	if minutes == 0 {
		minutes = 60
	}
	d := time.UnixMilli(ms)
	totalMin := d.Hour()*60 + d.Minute()
	roundedMin := totalMin / minutes * minutes
	t := time.Date(d.Year(), d.Month(), d.Day(), 0, roundedMin, 0, 0, time.UTC)
	return t.UnixMilli()
}

func makeSnapshot(hour int, price float64, timestamp int64, acct *account.Account, stoppedLots []account.StoppedLot, action string, initialBalance float64) Snapshot {
	equity := acct.Equity(price)
	unrealizedPnL := acct.UnrealizedPnL(price)
	return Snapshot{
		Hour:           hour,
		Timestamp:      timestamp,
		OpenPrice:      price,
		Equity:         round2(equity),
		Balance:        round2(acct.Balance),
		UnrealizedPnL:  round2(unrealizedPnL),
		LongPnL:        round2(acct.LongPnL(price)),
		ShortPnL:       round2(acct.ShortPnL(price)),
		TotalReturnPct: round2((equity - initialBalance) / initialBalance * 100),
		LongLots:       cloneLots(acct.LongLots),
		ShortLots:      cloneLots(acct.ShortLots),
		StoppedLots:    stoppedLots,
		Action:         action,
	}
}

func countReason(lots []account.StoppedLot, reason string) int {
	n := 0
	for _, l := range lots {
		if l.Reason == reason {
			n++
		}
	}
	return n
}

func fmtCount(n int, label string) string {
	switch label {
	case "sl", "stop":
		return fmt.Sprintf("sl:%d", n)
	case "tp":
		return fmt.Sprintf("tp:%d", n)
	default:
		return fmt.Sprintf("%s:%d", label, n)
	}
}

func joinAction(parts []string) string {
	s := ""
	for i, p := range parts {
		if i > 0 {
			s += " "
		}
		s += p
	}
	return s
}

func cloneLots(lots []account.Lot) []account.Lot {
	out := make([]account.Lot, len(lots))
	copy(out, lots)
	return out
}

func cloneState(s LiveState) LiveState {
	s.LongLots = cloneLots(s.LongLots)
	s.ShortLots = cloneLots(s.ShortLots)
	s.Snapshots = append([]Snapshot(nil), s.Snapshots...)
	s.LogEntries = append([]string(nil), s.LogEntries...)
	return s
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

