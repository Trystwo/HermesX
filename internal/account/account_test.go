package account

import (
	"testing"
)

func TestNew(t *testing.T) {
	a := New(1000)
	if a.Balance != 1000 {
		t.Errorf("balance = %v, want 1000", a.Balance)
	}
	if len(a.LongLots) != 0 || len(a.ShortLots) != 0 {
		t.Error("lots should be empty")
	}
}

func TestOpenBoth(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)

	if len(a.LongLots) != 1 {
		t.Fatal("expected 1 long lot")
	}
	if len(a.ShortLots) != 1 {
		t.Fatal("expected 1 short lot")
	}

	l := a.LongLots[0]
	if l.Side != Long {
		t.Errorf("side = %v, want long", l.Side)
	}
	if l.EntryPrice != 50000 {
		t.Errorf("entryPrice = %v, want 50000", l.EntryPrice)
	}

	s := a.ShortLots[0]
	if s.Side != Short {
		t.Errorf("side = %v, want short", s.Side)
	}
	if s.SLPrice != 50000*(1+0.03) {
		t.Errorf("short SL = %v, want %v", s.SLPrice, 50000*(1+0.03))
	}

	// balance should be deducted: 1000 - 200 (margin) - fees
	if a.Balance >= 800 {
		t.Errorf("balance = %v, expected ~800 after margin+fees", a.Balance)
	}
}

func TestCheckCloseConditions_LongStopLoss(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)

	closed := a.CheckCloseConditions(51000, 48000, 0.0002)
	// low=48000, long SL=50000*0.97=48500, so 48000 < 48500 → stop loss triggered
	if len(closed) != 1 {
		t.Fatalf("expected 1 closed lot, got %d", len(closed))
	}
	if closed[0].Reason != "sl" {
		t.Errorf("reason = %v, want sl", closed[0].Reason)
	}
	if closed[0].Side != "long" {
		t.Errorf("side = %v, want long", closed[0].Side)
	}
	if len(a.LongLots) != 0 {
		t.Error("long lot should be removed")
	}
	if len(a.ShortLots) != 1 {
		t.Error("short lot should remain")
	}
}

func TestCheckCloseConditions_ShortStopLoss(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)

	closed := a.CheckCloseConditions(52000, 49000, 0.0002)
	// high=52000, short SL=50000*1.03=51500, so 52000 >= 51500 → stop loss triggered
	if len(closed) != 1 {
		t.Fatalf("expected 1 closed lot, got %d", len(closed))
	}
	if closed[0].Reason != "sl" {
		t.Errorf("reason = %v, want sl", closed[0].Reason)
	}
	if closed[0].Side != "short" {
		t.Errorf("side = %v, want short", closed[0].Side)
	}
}

func TestCheckCloseConditions_LongTakeProfit(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)

	// high=52000: long TP=50000*1.05=52500 (not hit), short SL=50000*1.03=51500 (hit)
	closed := a.CheckCloseConditions(52000, 51000, 0.0002)
	if len(closed) != 1 {
		t.Fatalf("expected 1 closed lot, got %d", len(closed))
	}
	if closed[0].Reason != "sl" || closed[0].Side != "short" {
		t.Errorf("reason = %v side = %v, want sl/short", closed[0].Reason, closed[0].Side)
	}
}

func TestCheckCloseConditions_ShortTakeProfit(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)

	// low=48000: short TP=50000*0.95=47500 (not hit), long SL=50000*0.97=48500 (hit)
	closed := a.CheckCloseConditions(49000, 48000, 0.0002)
	if len(closed) != 1 {
		t.Fatalf("expected 1 closed lot, got %d", len(closed))
	}
	if closed[0].Reason != "sl" || closed[0].Side != "long" {
		t.Errorf("reason = %v side = %v, want sl/long", closed[0].Reason, closed[0].Side)
	}
}

func TestCheckCloseConditions_BothTakeProfit(t *testing.T) {
	a := New(1000)
	// Set SL very wide so only TP triggers
	a.OpenLong(50000, 100, 3, 0.0002, 0.50, 0.05)
	a.OpenShort(50000, 100, 3, 0.0002, 0.50, 0.05)

	// high=53000 > long TP=52500, low=47000 < short TP=47500
	closed := a.CheckCloseConditions(53000, 47000, 0.0002)
	if len(closed) != 2 {
		t.Fatalf("expected 2 closed lots, got %d", len(closed))
	}
	tpCount := 0
	for _, c := range closed {
		if c.Reason == "tp" {
			tpCount++
		}
	}
	if tpCount != 2 {
		t.Errorf("expected 2 tp, got %d", tpCount)
	}
}

func TestUnrealizedPnL(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)

	// price went up 1%
	pnl := a.UnrealizedPnL(50500)
	// long profit ≈ (50500-50000) * qty, short loss ≈ (50000-50500) * qty
	// qty = 100*3/50000 = 0.006
	// long pnl = 500 * 0.006 = 3, short pnl = -500 * 0.006 = -3
	// total ≈ 0
	if pnl > 1 || pnl < -1 {
		t.Errorf("pnl = %v, expected near 0 (hedged)", pnl)
	}
}

func TestEquity(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)
	eq := a.Equity(50000)
	// equity = balance + margin + unrealizedPnL
	// base guess: ~800 + 200 + 0 = 1000 (minus fees)
	if eq < 990 || eq > 1010 {
		t.Errorf("equity = %v, expected ~1000", eq)
	}
}

func TestOpenDirection(t *testing.T) {
	a := New(1000)
	a.OpenLong(50000, 100, 3, 0.0002, 0.03, 0.05)
	if len(a.LongLots) != 1 {
		t.Fatal("expected 1 long lot")
	}
	if len(a.ShortLots) != 0 {
		t.Fatal("expected 0 short lots")
	}

	b := New(1000)
	b.OpenShort(50000, 100, 3, 0.0002, 0.03, 0.05)
	if len(b.LongLots) != 0 {
		t.Fatal("expected 0 long lots")
	}
	if len(b.ShortLots) != 1 {
		t.Fatal("expected 1 short lot")
	}
}

func TestTotalMargin(t *testing.T) {
	a := New(1000)
	a.OpenBoth(50000, 100, 3, 0.0002, 0.03, 0.05)
	if a.TotalMargin() != 200 {
		t.Errorf("totalMargin = %v, want 200", a.TotalMargin())
	}
}

func TestConcurrentAccess(t *testing.T) {
	a := New(10000)
	done := make(chan struct{})
	for i := 0; i < 20; i++ {
		go func() {
			for j := 0; j < 50; j++ {
				a.OpenBoth(50000, 10, 3, 0.0002, 0.03, 0.05)
				a.CheckCloseConditions(51000, 49000, 0.0002)
				a.UnrealizedPnL(50500)
				a.Equity(50500)
				a.TotalMargin()
				a.LongPnL(50500)
				a.ShortPnL(50500)
			}
			done <- struct{}{}
		}()
	}
	for i := 0; i < 20; i++ {
		<-done
	}
}
