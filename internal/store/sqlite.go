package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type HistorySummary struct {
	ID              string  `json:"id"`
	Timestamp       int64   `json:"timestamp"`
	Symbol          string  `json:"symbol"`
	Days            int     `json:"days"`
	Leverage        int     `json:"leverage"`
	MarginRatio     float64 `json:"marginRatio"`
	TotalReturnPct  float64 `json:"totalReturnPct"`
	MaxDrawdownPct  float64 `json:"maxDrawdownPct"`
	HoursElapsed    int     `json:"hoursElapsed"`
	OrderCount      int     `json:"orderCount"`
	StopCount       int     `json:"stopCount"`
}

type HistoryOrder struct {
	Hour   int     `json:"hour"`
	Time   string  `json:"time"`
	Action string  `json:"action"`
	Price  float64 `json:"price"`
	Profit float64 `json:"profit"`
}

type PositionRecord struct {
	Side         string  `json:"side"`
	EntryPrice   float64 `json:"entryPrice"`
	Quantity     float64 `json:"quantity"`
	PnL          float64 `json:"pnl"`
	CurrentPrice float64 `json:"currentPrice"`
}

type HistoryDetail struct {
	HistorySummary
	Config    map[string]interface{} `json:"config"`
	Orders    []HistoryOrder         `json:"orders"`
	Positions []PositionRecord       `json:"positions"`
}

type SaveParams struct {
	Symbol     string
	Days       int
	Leverage   int
	MarginRatio float64
	Summary    struct {
		TotalReturnPct  float64
		MaxDrawdownPct  float64
		HoursElapsed    int
		StopCount       int
	}
	Config    map[string]interface{}
	Orders    []HistoryOrder
	Positions []PositionRecord
}

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite single-writer
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	ddl := `
	CREATE TABLE IF NOT EXISTS history (
		id             TEXT PRIMARY KEY,
		created_at     INTEGER NOT NULL,
		symbol         TEXT NOT NULL,
		days           INTEGER NOT NULL,
		leverage       INTEGER NOT NULL,
		margin_ratio   REAL NOT NULL,
		total_return   REAL NOT NULL,
		max_drawdown   REAL NOT NULL,
		hours_elapsed  INTEGER NOT NULL,
		stop_count     INTEGER NOT NULL DEFAULT 0,
		order_count    INTEGER NOT NULL DEFAULT 0,
		config_json    TEXT NOT NULL,
		orders_json    TEXT NOT NULL,
		positions_json TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
	`
	_, err := db.Exec(ddl)
	return err
}

func (s *Store) Save(params SaveParams) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := genID()
	now := time.Now().UnixMilli()

	configJSON, _ := json.Marshal(params.Config)
	ordersJSON, _ := json.Marshal(params.Orders)
	positionsJSON, _ := json.Marshal(params.Positions)

	_, err := s.db.Exec(
		`INSERT INTO history (id, created_at, symbol, days, leverage, margin_ratio,
		 total_return, max_drawdown, hours_elapsed, stop_count, order_count,
		 config_json, orders_json, positions_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, now, params.Symbol, params.Days, params.Leverage, params.MarginRatio,
		params.Summary.TotalReturnPct, params.Summary.MaxDrawdownPct,
		params.Summary.HoursElapsed, params.Summary.StopCount, len(params.Orders),
		string(configJSON), string(ordersJSON), string(positionsJSON),
	)
	if err != nil {
		return "", fmt.Errorf("insert: %w", err)
	}
	return id, nil
}

func (s *Store) List(limit, offset int) ([]HistorySummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rows, err := s.db.Query(
		`SELECT id, created_at, symbol, days, leverage, margin_ratio,
		 total_return, max_drawdown, hours_elapsed, stop_count, order_count
		 FROM history ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []HistorySummary
	for rows.Next() {
		var h HistorySummary
		if err := rows.Scan(&h.ID, &h.Timestamp, &h.Symbol, &h.Days, &h.Leverage,
			&h.MarginRatio, &h.TotalReturnPct, &h.MaxDrawdownPct,
			&h.HoursElapsed, &h.StopCount, &h.OrderCount); err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}

func (s *Store) Get(id string) (*HistoryDetail, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var h HistoryDetail
	var configJSON, ordersJSON, positionsJSON string
	err := s.db.QueryRow(
		`SELECT id, created_at, symbol, days, leverage, margin_ratio,
		 total_return, max_drawdown, hours_elapsed, stop_count, order_count,
		 config_json, orders_json, positions_json
		 FROM history WHERE id = ?`, id,
	).Scan(&h.ID, &h.Timestamp, &h.Symbol, &h.Days, &h.Leverage,
		&h.MarginRatio, &h.TotalReturnPct, &h.MaxDrawdownPct,
		&h.HoursElapsed, &h.StopCount, &h.OrderCount,
		&configJSON, &ordersJSON, &positionsJSON,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal([]byte(configJSON), &h.Config)
	json.Unmarshal([]byte(ordersJSON), &h.Orders)
	json.Unmarshal([]byte(positionsJSON), &h.Positions)
	return &h, nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	res, err := s.db.Exec("DELETE FROM history WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func genID() string {
	now := time.Now().UnixMilli()
	return strings.ToLower(fmt.Sprintf("%x-%04x", now, now%65535))
}
