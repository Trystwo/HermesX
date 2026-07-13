package market

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const restBase = "https://fapi.binance.com"

type BinanceMarket struct {
	symbol string
	wsURL  string

	priceMu     sync.RWMutex
	currentPrice float64

	priceCh  chan PriceUpdate
	candleCh chan Candle

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func NewBinance(symbol, wsURL string) *BinanceMarket {
	return &BinanceMarket{
		symbol:   symbol,
		wsURL:    wsURL,
		priceCh:  make(chan PriceUpdate, 64),
		candleCh: make(chan Candle, 8),
	}
}

func (m *BinanceMarket) CurrentPrice() float64 {
	m.priceMu.RLock()
	defer m.priceMu.RUnlock()
	return m.currentPrice
}

func (m *BinanceMarket) PriceChan() <-chan PriceUpdate {
	return m.priceCh
}

func (m *BinanceMarket) CandleChan() <-chan Candle {
	return m.candleCh
}

func (m *BinanceMarket) Start(ctx context.Context) error {
	m.ctx, m.cancel = context.WithCancel(ctx)
	m.wg.Add(2)
	go m.runWS()
	go m.pollCandles()
	return nil
}

func (m *BinanceMarket) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
	m.wg.Wait()
}

func (m *BinanceMarket) runWS() {
	defer m.wg.Done()
	for attempt := 0; ; attempt++ {
		if m.ctx.Err() != nil {
			return
		}
		m.connectWS(attempt)
		if m.ctx.Err() != nil {
			return
		}
		delay := time.Duration(math.Min(float64(5000*int64(1<<attempt)), 60_000)) * time.Millisecond
		select {
		case <-m.ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func (m *BinanceMarket) connectWS(attempt int) {
	url := fmt.Sprintf("%s/ws", m.wsURL)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(m.ctx, url, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Subscribe to bookTicker
	sub := map[string]interface{}{
		"method": "SUBSCRIBE",
		"params": []string{fmt.Sprintf("%s@bookTicker", m.symbol)},
		"id":     1,
	}
	if err := conn.WriteJSON(sub); err != nil {
		return
	}

	// Ping timer
	pingTicker := time.NewTicker(3 * time.Minute)
	defer pingTicker.Stop()

	go func() {
		for {
			select {
			case <-m.ctx.Done():
				return
			case <-pingTicker.C:
				conn.WriteMessage(websocket.PingMessage, nil)
			}
		}
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if _, ok := msg["result"]; ok {
			continue // subscription confirmation
		}
		if e, ok := msg["e"]; ok && e == "bookTicker" {
			bid := parseFloat(msg["b"])
			ask := parseFloat(msg["a"])
			if bid > 0 && ask > 0 {
				price := (bid + ask) / 2
				m.priceMu.Lock()
				m.currentPrice = price
				m.priceMu.Unlock()
				select {
				case m.priceCh <- PriceUpdate{Price: price, Time: time.Now().UnixMilli()}:
				default:
				}
			}
		}
	}
}

func (m *BinanceMarket) pollCandles() {
	defer m.wg.Done()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var lastCandle *Candle

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			candle, err := m.fetchLatestCandle()
			if err != nil || candle == nil {
				continue
			}
			if lastCandle == nil || candle.OpenTime > lastCandle.OpenTime {
				lastCandle = candle
				select {
				case m.candleCh <- *candle:
				default:
				}
			}
		}
	}
}

func (m *BinanceMarket) fetchLatestCandle() (*Candle, error) {
	url := fmt.Sprintf("%s/fapi/v1/klines?symbol=%s&interval=1h&limit=1", restBase, m.symbol)
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var data [][]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	k := data[0]
	return &Candle{
		OpenTime: int64(parseFloat(k[0])),
			Open:     parseFloat(k[1]),
			High:     parseFloat(k[2]),
			Low:      parseFloat(k[3]),
			Close:    parseFloat(k[4]),
	}, nil
}

func parseFloat(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case string:
		var f float64
		fmt.Sscanf(val, "%f", &f)
		return f
	}
	return 0
}

// FetchCandles fetches historical klines for backtesting
func FetchCandles(symbol, interval string, days int) ([]Candle, error) {
	cpd := candlesPerDay(interval)
	limit := min(days*cpd, 1500)
	url := fmt.Sprintf("%s/fapi/v1/klines?symbol=%s&interval=%s&limit=%d",
		restBase, symbol, interval, limit)

	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("binance API error: %d", resp.StatusCode)
	}

	var raw [][]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	candles := make([]Candle, len(raw))
	for i, k := range raw {
		candles[i] = Candle{
			OpenTime: int64(parseFloat(k[0])),
			Open:     parseFloat(k[1]),
			High:     parseFloat(k[2]),
			Low:      parseFloat(k[3]),
			Close:    parseFloat(k[4]),
		}
	}

	needed := days * cpd
	for len(candles) < needed && len(candles) >= 1500 {
		earliest := candles[0].OpenTime
		url2 := fmt.Sprintf("%s/fapi/v1/klines?symbol=%s&interval=%s&limit=1500&endTime=%d",
			restBase, symbol, interval, earliest-1)
		resp2, err := http.Get(url2)
		if err != nil {
			break
		}
		var raw2 [][]interface{}
		if err := json.NewDecoder(resp2.Body).Decode(&raw2); err != nil {
			resp2.Body.Close()
			break
		}
		resp2.Body.Close()
		if len(raw2) == 0 {
			break
		}
		more := make([]Candle, len(raw2))
		for i, k := range raw2 {
			more[i] = Candle{
				OpenTime: int64(parseFloat(k[0])),
				Open:     parseFloat(k[1]),
				High:     parseFloat(k[2]),
				Low:      parseFloat(k[3]),
				Close:    parseFloat(k[4]),
			}
		}
		candles = append(more, candles...)
		if len(more) < 1500 {
			break
		}
	}

	if len(candles) > needed {
		candles = candles[len(candles)-needed:]
	}
	return candles, nil
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
