package account

import "sync"

type Side string

const (
	Long  Side = "long"
	Short Side = "short"
)

type Lot struct {
	Side       Side    `json:"side"`
	EntryPrice float64 `json:"entryPrice"`
	Quantity   float64 `json:"quantity"`
	Margin     float64 `json:"margin"`
	SLPrice    float64 `json:"slPrice"`
	TPPrice    float64 `json:"tpPrice"`
}

type StoppedLot struct {
	Side       string  `json:"side"`
	EntryPrice float64 `json:"entryPrice"`
	Quantity   float64 `json:"quantity"`
	ClosePrice float64 `json:"closePrice"`
	PnL        float64 `json:"pnl"`
	Fee        float64 `json:"fee"`
	Reason     string  `json:"reason"`
}

type Account struct {
	mu        sync.Mutex
	Balance   float64 `json:"balance"`
	LongLots  []Lot   `json:"longLots"`
	ShortLots []Lot   `json:"shortLots"`
}

func New(initialBalance float64) *Account {
	return &Account{Balance: initialBalance}
}

func (a *Account) calcPositionValue(margin, leverage float64) float64 {
	return margin * leverage
}

func (a *Account) OpenBoth(price, marginPerSide, leverage, feeRate, slPct, tpPct float64) {
	a.mu.Lock()
	defer a.mu.Unlock()

	posValue := a.calcPositionValue(marginPerSide, leverage)
	qty := posValue / price
	fee := posValue * feeRate

	a.Balance -= marginPerSide*2 + fee*2

	a.LongLots = append(a.LongLots, Lot{
		Side: Long, EntryPrice: price, Quantity: qty, Margin: marginPerSide,
		SLPrice: price * (1 - slPct), TPPrice: price * (1 + tpPct),
	})
	a.ShortLots = append(a.ShortLots, Lot{
		Side: Short, EntryPrice: price, Quantity: qty, Margin: marginPerSide,
		SLPrice: price * (1 + slPct), TPPrice: price * (1 - tpPct),
	})
}

func (a *Account) OpenLong(price, marginPerSide, leverage, feeRate, slPct, tpPct float64) {
	a.mu.Lock()
	defer a.mu.Unlock()

	posValue := a.calcPositionValue(marginPerSide, leverage)
	qty := posValue / price
	fee := posValue * feeRate

	a.Balance -= marginPerSide + fee
	a.LongLots = append(a.LongLots, Lot{
		Side: Long, EntryPrice: price, Quantity: qty, Margin: marginPerSide,
		SLPrice: price * (1 - slPct), TPPrice: price * (1 + tpPct),
	})
}

func (a *Account) OpenShort(price, marginPerSide, leverage, feeRate, slPct, tpPct float64) {
	a.mu.Lock()
	defer a.mu.Unlock()

	posValue := a.calcPositionValue(marginPerSide, leverage)
	qty := posValue / price
	fee := posValue * feeRate

	a.Balance -= marginPerSide + fee
	a.ShortLots = append(a.ShortLots, Lot{
		Side: Short, EntryPrice: price, Quantity: qty, Margin: marginPerSide,
		SLPrice: price * (1 + slPct), TPPrice: price * (1 - tpPct),
	})
}

func (a *Account) CheckCloseConditions(prevHigh, prevLow, feeRate float64) []StoppedLot {
	a.mu.Lock()
	defer a.mu.Unlock()

	var closed []StoppedLot

	closeLong := func(lot Lot, price float64, reason string) {
		pnl := (price - lot.EntryPrice) * lot.Quantity
		fee := price * lot.Quantity * feeRate
		a.Balance += lot.Margin + pnl - fee
		closed = append(closed, StoppedLot{
			Side: "long", EntryPrice: lot.EntryPrice, Quantity: lot.Quantity,
			ClosePrice: price,
			PnL: round2(pnl), Fee: round2(fee), Reason: reason,
		})
	}

	closeShort := func(lot Lot, price float64, reason string) {
		pnl := (lot.EntryPrice - price) * lot.Quantity
		fee := price * lot.Quantity * feeRate
		a.Balance += lot.Margin + pnl - fee
		closed = append(closed, StoppedLot{
			Side: "short", EntryPrice: lot.EntryPrice, Quantity: lot.Quantity,
			ClosePrice: price,
			PnL: round2(pnl), Fee: round2(fee), Reason: reason,
		})
	}

	var remainingLong []Lot
	for _, lot := range a.LongLots {
		if prevLow <= lot.SLPrice {
			closeLong(lot, lot.SLPrice, "sl")
		} else if prevHigh >= lot.TPPrice {
			closeLong(lot, lot.TPPrice, "tp")
		} else {
			remainingLong = append(remainingLong, lot)
		}
	}
	a.LongLots = remainingLong

	var remainingShort []Lot
	for _, lot := range a.ShortLots {
		if prevHigh >= lot.SLPrice {
			closeShort(lot, lot.SLPrice, "sl")
		} else if prevLow <= lot.TPPrice {
			closeShort(lot, lot.TPPrice, "tp")
		} else {
			remainingShort = append(remainingShort, lot)
		}
	}
	a.ShortLots = remainingShort

	return closed
}

func (a *Account) UnrealizedPnL(currentPrice float64) float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.unrealizedPnL(currentPrice)
}

func (a *Account) unrealizedPnL(currentPrice float64) float64 {
	var pnl float64
	for _, lot := range a.LongLots {
		pnl += (currentPrice - lot.EntryPrice) * lot.Quantity
	}
	for _, lot := range a.ShortLots {
		pnl += (lot.EntryPrice - currentPrice) * lot.Quantity
	}
	return pnl
}

func (a *Account) LongPnL(currentPrice float64) float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	var pnl float64
	for _, lot := range a.LongLots {
		pnl += (currentPrice - lot.EntryPrice) * lot.Quantity
	}
	return pnl
}

func (a *Account) ShortPnL(currentPrice float64) float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	var pnl float64
	for _, lot := range a.ShortLots {
		pnl += (lot.EntryPrice - currentPrice) * lot.Quantity
	}
	return pnl
}

func (a *Account) Equity(currentPrice float64) float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.Balance + a.totalMargin() + a.unrealizedPnL(currentPrice)
}

func (a *Account) TotalMargin() float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.totalMargin()
}

func (a *Account) totalMargin() float64 {
	var m float64
	for _, lot := range a.LongLots {
		m += lot.Margin
	}
	for _, lot := range a.ShortLots {
		m += lot.Margin
	}
	return m
}

func (a *Account) Snapshot(currentPrice float64) (balance float64, longLots, shortLots []Lot) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.Balance, cloneLots(a.LongLots), cloneLots(a.ShortLots)
}

func cloneLots(lots []Lot) []Lot {
	out := make([]Lot, len(lots))
	copy(out, lots)
	return out
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
