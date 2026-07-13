package market

import (
	"context"
	"math/rand"
	"sync"
	"time"
)

type MockMarket struct {
	price       float64
	mu          sync.Mutex
	priceCh     chan PriceUpdate
	candleCh    chan Candle
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

func NewMock(initialPrice float64) *MockMarket {
	if initialPrice <= 0 {
		initialPrice = 50000
	}
	return &MockMarket{
		price:    initialPrice,
		priceCh:  make(chan PriceUpdate, 64),
		candleCh: make(chan Candle, 8),
	}
}

func (m *MockMarket) CurrentPrice() float64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.price
}

func (m *MockMarket) PriceChan() <-chan PriceUpdate {
	return m.priceCh
}

func (m *MockMarket) CandleChan() <-chan Candle {
	return m.candleCh
}

func (m *MockMarket) Start(ctx context.Context) error {
	m.ctx, m.cancel = context.WithCancel(ctx)

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(300 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-m.ctx.Done():
				return
			case <-ticker.C:
				m.mu.Lock()
				change := m.price * (rand.Float64() - 0.5) * 0.003
				m.price += change
				p := m.price
				m.mu.Unlock()
				select {
				case m.priceCh <- PriceUpdate{Price: p, Time: time.Now().UnixMilli()}:
				default:
				}
			}
		}
	}()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-m.ctx.Done():
				return
			case <-ticker.C:
				m.mu.Lock()
				open := m.price
				high := open * (1 + rand.Float64()*0.005)
				low := open * (1 - rand.Float64()*0.005)
				m.mu.Unlock()
				candle := Candle{
					OpenTime: time.Now().UnixMilli(),
					Open:     open,
					High:     high,
					Low:      low,
					Close:    low + rand.Float64()*(high-low),
				}
				select {
				case m.candleCh <- candle:
				default:
				}
			}
		}
	}()

	return nil
}

func (m *MockMarket) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
	m.wg.Wait()
}
