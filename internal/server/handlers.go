package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"hermesx/internal/backtest"
	"hermesx/internal/config"
	"hermesx/internal/store"
	"hermesx/internal/strategy"

	"github.com/go-chi/chi/v5"
)

type Handlers struct {
	engine *strategy.Engine
	runner *backtest.Runner
	store  *store.Store
	cfg    config.Config
}

func NewHandlers(engine *strategy.Engine, runner *backtest.Runner, store *store.Store, cfg config.Config) *Handlers {
	return &Handlers{engine: engine, runner: runner, store: store, cfg: cfg}
}

func (h *Handlers) Register(r chi.Router) {
	r.Get("/api/config", h.handleConfig)
	r.Post("/api/backtest/init", h.handleBacktestInit)
	r.Post("/api/backtest/step", h.handleBacktestStep)
	r.Post("/api/backtest/runAll", h.handleBacktestRunAll)
	r.Post("/api/live/start", h.handleLiveStart)
	r.Post("/api/live/stop", h.handleLiveStop)
	r.Get("/api/live/state", h.handleLiveState)
	r.Get("/api/live/balance", h.handleLiveBalance)
	r.Get("/api/history", h.handleHistoryList)
	r.Get("/api/history/{id}", h.handleHistoryGet)
	r.Delete("/api/history/{id}", h.handleHistoryDelete)
}

func (h *Handlers) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{
		"stopLossPercent":    h.cfg.StopLossPercent,
		"takeProfitPercent":  h.cfg.TakeProfitPercent,
		"initialBalance":     h.cfg.InitialBalance,
		"leverage":           h.cfg.Leverage,
		"positionAmountValue": h.cfg.PositionAmountValue,
		"interval":           h.cfg.Interval,
		"symbol":             h.cfg.Symbol,
	})
}

func (h *Handlers) handleBacktestInit(w http.ResponseWriter, r *http.Request) {
	var params backtest.Params
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		writeError(w, "invalid params")
		return
	}
	state, err := h.runner.Init(r.Context(), params)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "state": state})
}

func (h *Handlers) handleBacktestStep(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request")
		return
	}
	state, err := h.runner.Step(req.ID)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "state": state})
}

func (h *Handlers) handleBacktestRunAll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request")
		return
	}
	state, err := h.runner.RunAll(req.ID)
	if err != nil {
		writeError(w, err.Error())
		return
	}

	// Save to history
	cpd := candlesPerDay(state.Params.Interval)
	days := len(state.Candles) / cpd
	if cpd == 0 {
		days = 0
	}

	var lastSnap *backtest.Snapshot
	if len(state.Snapshots) > 0 {
		lastSnap = &state.Snapshots[len(state.Snapshots)-1]
	}
	totalReturnPct := 0.0
	if lastSnap != nil {
		totalReturnPct = lastSnap.TotalReturnPct
	}

	// Calculate max drawdown
	peak := state.InitialBalance
	maxDd := 0.0
	for _, s := range state.Snapshots {
		if s.Equity > peak {
			peak = s.Equity
		}
		dd := 0.0
		if peak > 0 {
			dd = (peak - s.Equity) / peak * 100
		}
		if dd > maxDd {
			maxDd = dd
		}
	}

	orders := make([]store.HistoryOrder, 0)
	for _, s := range state.Snapshots {
		if s.Action == "" || s.Action == "insufficient equity" {
			continue
		}
		t := timestampToTime(s.Timestamp)
		orders = append(orders, store.HistoryOrder{
			Hour: s.Hour, Time: t, Action: s.Action, Price: s.OpenPrice,
		})
	}

	stopCount := 0
	for _, s := range state.Snapshots {
		for _, sl := range s.StoppedLots {
			if sl.Reason == "sl" {
				stopCount++
			}
		}
	}

	positions := make([]store.PositionRecord, 0)
	lastPrice := 0.0
	if lastSnap != nil {
		lastPrice = lastSnap.OpenPrice
	}
	for _, l := range state.LongLots {
		positions = append(positions, store.PositionRecord{
			Side: "long", EntryPrice: l.EntryPrice, Quantity: l.Quantity,
			PnL: (lastPrice - l.EntryPrice) * l.Quantity, CurrentPrice: lastPrice,
		})
	}
	for _, l := range state.ShortLots {
		positions = append(positions, store.PositionRecord{
			Side: "short", EntryPrice: l.EntryPrice, Quantity: l.Quantity,
			PnL: (l.EntryPrice - lastPrice) * l.Quantity, CurrentPrice: lastPrice,
		})
	}

	_, _ = h.store.Save(store.SaveParams{
		Symbol: state.Params.Symbol, Days: days, Leverage: state.Params.Leverage,
		MarginRatio: state.Params.MarginRatio,
		Summary: struct {
			TotalReturnPct float64
			MaxDrawdownPct float64
			HoursElapsed   int
			StopCount      int
		}{totalReturnPct, round2(maxDd), len(state.Candles), stopCount},
		Config: map[string]interface{}{
			"interval":            state.Params.Interval,
			"stopLossPercent":     state.Params.StopLossPercent,
			"takeProfitPercent":   state.Params.TakeProfitPercent,
			"positionAmountValue": state.Params.PositionAmountValue,
			"initialBalance":      state.InitialBalance,
			"leverage":            state.Params.Leverage,
			"direction":           state.Params.Direction,
		},
		Orders:    orders,
		Positions: positions,
	})

	writeJSON(w, map[string]interface{}{"success": true, "state": state})
}

func (h *Handlers) handleLiveStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Config *struct {
			Leverage            *int     `json:"leverage"`
			StopLossPercent     *float64 `json:"stopLossPercent"`
			TakeProfitPercent   *float64 `json:"takeProfitPercent"`
			PositionAmountValue *float64 `json:"positionAmountValue"`
			Mode                *string  `json:"mode"`
			Interval            *string  `json:"interval"`
			Direction           *string  `json:"direction"`
			InitialBalance      *float64 `json:"initialBalance"`
		} `json:"config"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	cfg := h.engine.State().Config
	if req.Config != nil {
		if v := req.Config.Leverage; v != nil {
			cfg.Leverage = *v
		}
		if v := req.Config.StopLossPercent; v != nil {
			cfg.StopLossPercent = *v
		}
		if v := req.Config.TakeProfitPercent; v != nil {
			cfg.TakeProfitPercent = *v
		}
		if v := req.Config.PositionAmountValue; v != nil {
			cfg.PositionAmountValue = *v
		}
		if v := req.Config.Mode; v != nil {
			cfg.Mode = *v
		}
		if v := req.Config.Interval; v != nil {
			cfg.Interval = *v
		}
		if v := req.Config.Direction; v != nil {
			cfg.Direction = *v
		}
		if v := req.Config.InitialBalance; v != nil {
			cfg.InitialBalance = *v
		}
	}
	h.engine.UpdateConfig(cfg)

	price := 0.0
	// Start engine asynchronously — API calls (balance, hedge mode, leverage, open)
	// may take several seconds and shouldn't block the HTTP response.
	go h.engine.Start(price, timestampHour(time.Now().UnixMilli()))

	writeJSON(w, map[string]interface{}{"success": true})
}

func (h *Handlers) handleLiveStop(w http.ResponseWriter, r *http.Request) {
	h.engine.Stop()
	writeJSON(w, map[string]interface{}{"success": true})
}

func (h *Handlers) handleLiveState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{"success": true, "state": h.engine.State()})
}

func (h *Handlers) handleLiveBalance(w http.ResponseWriter, r *http.Request) {
	bal := h.engine.GetExchangeBalance()
	writeJSON(w, map[string]interface{}{"success": true, "balance": bal})
}

func (h *Handlers) handleHistoryList(w http.ResponseWriter, r *http.Request) {
	items, err := h.store.List(100, 0)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	if items == nil {
		items = []store.HistorySummary{}
	}
	writeJSON(w, map[string]interface{}{"success": true, "items": items})
}

func (h *Handlers) handleHistoryGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	detail, err := h.store.Get(id)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	if detail == nil {
		writeError(w, "not found")
		return
	}
	writeJSON(w, map[string]interface{}{"success": true, "detail": detail})
}

func (h *Handlers) handleHistoryDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.store.Delete(id); err != nil {
		writeError(w, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"success": true})
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[api] encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": msg})
}

func candlesPerDay(interval string) int {
	m := map[string]int{
		"1m": 1440, "3m": 480, "5m": 288, "15m": 96, "30m": 48,
		"1h": 24, "2h": 12, "4h": 6, "6h": 4, "8h": 3, "12h": 2, "1d": 1,
	}
	if v, ok := m[interval]; ok {
		return v
	}
	return 24
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func timestampHour(ms int64) int64 {
	return ms - (ms % 3600000)
}

func timestampToTime(ms int64) string {
	hours := (ms / 3600000) % 24
	days := (ms / 86400000)
	return fmt.Sprintf("%dh-%dd", hours, days)
}
