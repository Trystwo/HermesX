package market

import "context"

type Candle struct {
	OpenTime int64   `json:"openTime"`
	Open     float64 `json:"open"`
	High     float64 `json:"high"`
	Low      float64 `json:"low"`
	Close    float64 `json:"close"`
}

type PriceUpdate struct {
	Price float64 `json:"price"`
	Time  int64   `json:"time"`
}

type Market interface {
	Start(ctx context.Context) error
	CurrentPrice() float64
	PriceChan() <-chan PriceUpdate
	CandleChan() <-chan Candle
}

type Fetcher interface {
	FetchCandles(symbol, interval string, days int) ([]Candle, error)
}
