package backtest

import (
	"context"
	"fmt"
	"math"
	"sync"

	"hermesx/internal/account"
	"hermesx/internal/market"
)

const feeRate = 0.0002
const maxSnapshots = 2000

type Params struct {
	Symbol              string  `json:"symbol"`
	Days                int     `json:"days"`
	Interval            string  `json:"interval"`
	Leverage            int     `json:"leverage"`
	MarginRatio         float64 `json:"marginRatio"`
	StopLossPercent     float64 `json:"stopLossPercent"`
	TakeProfitPercent   float64 `json:"takeProfitPercent"`
	PositionAmountValue float64 `json:"positionAmountValue"`
	InitialBalance      float64 `json:"initialBalance"`
	Direction           string  `json:"direction"`
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

type AllLotRecord struct {
	Side       string  `json:"side"`
	EntryPrice float64 `json:"entryPrice"`
	SLPrice    float64 `json:"slPrice"`
	TPPrice    float64 `json:"tpPrice"`
	Quantity   float64 `json:"quantity"`
	Margin     float64 `json:"margin"`
	OpenTime   int64   `json:"openTime"`
	Status     string  `json:"status"`
	ClosePrice float64 `json:"closePrice,omitempty"`
	Reason     string  `json:"reason,omitempty"`
	PnL        float64 `json:"pnl,omitempty"`
	Fee        float64 `json:"fee,omitempty"`
}

type State struct {
	Symbol         string         `json:"symbol"`
	InitialBalance float64        `json:"initialBalance"`
	Params         Params         `json:"params"`
	Candles        []market.Candle `json:"candles"`
	CurrentIndex   int            `json:"currentIndex"`
	Balance        float64        `json:"balance"`
	LongLots       []account.Lot  `json:"longLots"`
	ShortLots      []account.Lot  `json:"shortLots"`
	Snapshots      []Snapshot     `json:"snapshots"`
	TotalFee       float64        `json:"totalFee"`
	TotalOpenCount int            `json:"totalOpenCount"`
	AllLots        []AllLotRecord `json:"allLots"`
	Done           bool           `json:"done"`
}

type Runner struct {
	mu     sync.Mutex
	states map[string]*State
}

func NewRunner() *Runner {
	return &Runner{
		states: make(map[string]*State),
	}
}

func (r *Runner) Init(ctx context.Context, params Params) (*State, error) {
	candles, err := market.FetchCandles(params.Symbol, params.Interval, params.Days)
	if err != nil {
		return nil, fmt.Errorf("fetch candles: %w", err)
	}
	if len(candles) < 1 {
		return nil, fmt.Errorf("got %d candles, need at least 1", len(candles))
	}

	if params.Direction == "" {
		params.Direction = "both"
	}

	state := &State{
		Symbol:         params.Symbol,
		InitialBalance: params.InitialBalance,
		Params:         params,
		Candles:        candles,
		Balance:        params.InitialBalance,
	}

	id := genID()
	r.mu.Lock()
	r.states[id] = state
	r.mu.Unlock()

	state.Symbol = id // store ID in Symbol field for client tracking
	return state, nil
}

func (r *Runner) Step(id string) (*State, error) {
	r.mu.Lock()
	state, ok := r.states[id]
	r.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("state not found: %s", id)
	}
	return stepBacktest(state), nil
}

func (r *Runner) RunAll(id string) (*State, error) {
	r.mu.Lock()
	state, ok := r.states[id]
	r.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("state not found: %s", id)
	}

	for !state.Done {
		stepBacktest(state)
	}
	return state, nil
}

func (r *Runner) GetState(id string) *State {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.states[id]
}

func (r *Runner) Cleanup(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.states, id)
}

func stepBacktest(s *State) *State {
	if s.Done || s.CurrentIndex >= len(s.Candles) {
		s.Done = true
		return s
	}

	candle := s.Candles[s.CurrentIndex]
	price := candle.Open

	acct := account.New(s.Balance)
	acct.LongLots = cloneLots(s.LongLots)
	acct.ShortLots = cloneLots(s.ShortLots)

	actionParts := make([]string, 0)
	var stoppedLots []account.StoppedLot

	if s.CurrentIndex > 0 {
		prev := s.Candles[s.CurrentIndex-1]
		stoppedLots = acct.CheckCloseConditions(prev.High, prev.Low, feeRate)
		slCount := countReason(stoppedLots, "sl")
		tpCount := countReason(stoppedLots, "tp")
		if slCount > 0 {
			actionParts = append(actionParts, fmt.Sprintf("sl:%d", slCount))
		}
		if tpCount > 0 {
			actionParts = append(actionParts, fmt.Sprintf("tp:%d", tpCount))
		}
	}

	closeFee := 0.0
	for _, sl := range stoppedLots {
		closeFee += sl.Fee
	}

	// Open new lots
	marginPerSide := s.Params.PositionAmountValue
	equity := acct.Equity(price)
	availableFunds := acct.Balance + acct.UnrealizedPnL(price)
	dir := s.Params.Direction
	sides := 2
	if dir != "both" {
		sides = 1
	}

	openFee := 0.0
	didOpen := false
	if equity > 0 && availableFunds >= marginPerSide*float64(sides) {
		posValue := marginPerSide * float64(s.Params.Leverage)
		qty := posValue / price
		now := candle.OpenTime

		if dir == "both" || dir == "long" {
			actionParts = append(actionParts, "open long")
			acct.OpenLong(price, marginPerSide, float64(s.Params.Leverage), feeRate, s.Params.StopLossPercent, s.Params.TakeProfitPercent)
			openFee += posValue * feeRate
			s.AllLots = append(s.AllLots, AllLotRecord{
				Side: "long", EntryPrice: price,
				SLPrice: price * (1 - s.Params.StopLossPercent),
				TPPrice: price * (1 + s.Params.TakeProfitPercent),
				Quantity: qty, Margin: marginPerSide, OpenTime: now, Status: "open",
			})
		}
		if dir == "both" || dir == "short" {
			actionParts = append(actionParts, "open short")
			acct.OpenShort(price, marginPerSide, float64(s.Params.Leverage), feeRate, s.Params.StopLossPercent, s.Params.TakeProfitPercent)
			openFee += posValue * feeRate
			s.AllLots = append(s.AllLots, AllLotRecord{
				Side: "short", EntryPrice: price,
				SLPrice: price * (1 + s.Params.StopLossPercent),
				TPPrice: price * (1 - s.Params.TakeProfitPercent),
				Quantity: qty, Margin: marginPerSide, OpenTime: now, Status: "open",
			})
		}
		didOpen = true
	} else {
		actionParts = append(actionParts, "insufficient equity")
	}

	action := joinStrings(actionParts)
	snap := makeBTSnapshot(s.CurrentIndex, candle, acct, stoppedLots, action, s.InitialBalance)

	s.CurrentIndex++
	s.Balance = acct.Balance
	s.LongLots = acct.LongLots
	s.ShortLots = acct.ShortLots
	s.Snapshots = append(s.Snapshots, snap)
	if len(s.Snapshots) > maxSnapshots {
		s.Snapshots = s.Snapshots[len(s.Snapshots)-maxSnapshots:]
	}
	s.TotalFee += openFee + closeFee
	if didOpen {
		s.TotalOpenCount++
	}
	if s.CurrentIndex >= len(s.Candles) {
		s.Done = true
	}

	return s
}

func makeBTSnapshot(hour int, candle market.Candle, acct *account.Account, stoppedLots []account.StoppedLot, action string, initialBalance float64) Snapshot {
	equity := acct.Equity(candle.Open)
	unrealizedPnL := acct.UnrealizedPnL(candle.Open)
	return Snapshot{
		Hour:           hour,
		Timestamp:      candle.OpenTime,
		OpenPrice:      candle.Open,
		Equity:         round2(equity),
		Balance:        round2(acct.Balance),
		UnrealizedPnL:  round2(unrealizedPnL),
		LongPnL:        round2(acct.LongPnL(candle.Open)),
		ShortPnL:       round2(acct.ShortPnL(candle.Open)),
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

func joinStrings(parts []string) string {
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

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

var idCounter int

func genID() string {
	idCounter++
	return fmt.Sprintf("bt-%d", idCounter)
}
