package exchange

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type PositionInfo struct {
	Symbol             string  `json:"symbol"`
	PositionAmt        float64 `json:"positionAmt"`
	EntryPrice         float64 `json:"entryPrice"`
	MarkPrice          float64 `json:"markPrice"`
	UnrealizedProfit   float64 `json:"unrealizedProfit"`
	Leverage           float64 `json:"leverage"`
}

type AccountInfo struct {
	TotalWalletBalance  float64 `json:"totalWalletBalance"`
	UnrealizedProfit    float64 `json:"totalUnrealizedProfit"`
	AvailableBalance    float64 `json:"availableBalance"`
}

type OrderResult struct {
	OrderID      int64   `json:"orderId"`
	Symbol       string  `json:"symbol"`
	ExecutedQty  float64 `json:"executedQty"`
	CumQuote     float64 `json:"cumQuote"`
	AvgPrice     float64 `json:"avgPrice"`
	Status       string  `json:"status"`
}

type Client struct {
	baseURL    string
	apiKey     string
	apiSecret  string
	httpClient *http.Client

	QuantityPrecision int
	PricePrecision    int
}

func NewClient(baseURL, apiKey, apiSecret string) *Client {
	return &Client{
		baseURL:           baseURL,
		apiKey:            apiKey,
		apiSecret:         apiSecret,
		httpClient:        &http.Client{Timeout: 10 * time.Second},
		QuantityPrecision: 6,
		PricePrecision:    1,
	}
}

func (c *Client) HasAPIKey() bool {
	return c.apiKey != "" && c.apiSecret != ""
}

func (c *Client) sign(query string) string {
	mac := hmac.New(sha256.New, []byte(c.apiSecret))
	mac.Write([]byte(query))
	return hex.EncodeToString(mac.Sum(nil))
}

func (c *Client) signedRequest(ctx context.Context, method, path string, params map[string]string) (map[string]interface{}, error) {
	if !c.HasAPIKey() {
		return nil, fmt.Errorf("binance API key/secret not configured")
	}

	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	q.Set("timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10))
	q.Set("recvWindow", "5000")
	queryStr := q.Encode()
	signature := c.sign(queryStr)

	reqURL := fmt.Sprintf("%s%s?%s&signature=%s", c.baseURL, path, queryStr, signature)
	req, err := http.NewRequestWithContext(ctx, method, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-MBX-APIKEY", c.apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("binance API error (%d): %s", resp.StatusCode, string(body))
	}
	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		var arr []map[string]interface{}
		if err2 := json.Unmarshal(body, &arr); err2 == nil && len(arr) > 0 {
			return arr[0], nil
		}
		return nil, fmt.Errorf("binance parse error: %v", err)
	}
	return data, nil
}

func (c *Client) publicGet(ctx context.Context, path string, params map[string]string) (map[string]interface{}, error) {
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	reqURL := fmt.Sprintf("%s%s", c.baseURL, path)
	if len(params) > 0 {
		reqURL += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("binance API error: %d", resp.StatusCode)
	}
	return data, nil
}

func (c *Client) MarketOpen(ctx context.Context, side string, quantity float64, positionSide, symbol string) (*OrderResult, error) {
	params := map[string]string{
		"symbol":           symbol,
		"side":             side,
		"type":             "MARKET",
		"quantity":         strconv.FormatFloat(quantity, 'f', c.QuantityPrecision, 64),
		"newOrderRespType": "RESULT",
	}
	if positionSide != "" {
		params["positionSide"] = positionSide
	}
	data, err := c.signedRequest(ctx, "POST", "/fapi/v1/order", params)
	if err != nil {
		return nil, err
	}
	return &OrderResult{
		OrderID:     int64(getFloat(data, "orderId")),
		Symbol:      getString(data, "symbol"),
		ExecutedQty: getFloat(data, "executedQty"),
		CumQuote:    getFloat(data, "cumQuote"),
		AvgPrice:    getFloat(data, "avgPrice"),
		Status:      getString(data, "status"),
	}, nil
}

func (c *Client) MarketClose(ctx context.Context, side string, quantity float64, positionSide, symbol string) (*OrderResult, error) {
	return c.MarketOpen(ctx, side, quantity, positionSide, symbol)
}

func (c *Client) PlaceReduceOrder(ctx context.Context, side string, quantity, stopPrice float64, orderType, symbol string) (*OrderResult, error) {
	posSide := "LONG"
	if side == "BUY" {
		posSide = "SHORT"
	}
	params := map[string]string{
		"symbol":           symbol,
		"side":             side,
		"type":             orderType,
		"quantity":         strconv.FormatFloat(quantity, 'f', c.QuantityPrecision, 64),
		"stopPrice":        strconv.FormatFloat(stopPrice, 'f', c.PricePrecision, 64),
		"positionSide":     posSide,
		"newOrderRespType": "RESULT",
	}
	data, err := c.signedRequest(ctx, "POST", "/fapi/v1/order", params)
	if err != nil {
		return nil, err
	}
	return &OrderResult{
		OrderID:     int64(getFloat(data, "orderId")),
		Symbol:      getString(data, "symbol"),
		ExecutedQty: getFloat(data, "executedQty"),
		AvgPrice:    getFloat(data, "avgPrice"),
		Status:      getString(data, "status"),
	}, nil
}

func (c *Client) CancelAllOrders(ctx context.Context, symbol string) error {
	_, err := c.signedRequest(ctx, "DELETE", "/fapi/v1/allOpenOrders", map[string]string{"symbol": symbol})
	return err
}

func (c *Client) SetHedgeMode(ctx context.Context) error {
	_, err := c.signedRequest(ctx, "POST", "/fapi/v1/positionSide/dual", map[string]string{
		"dualSidePosition": "true",
	})
	if err != nil && !isAlreadySet(err) {
		return err
	}
	return nil
}

func (c *Client) SetLeverage(ctx context.Context, symbol string, leverage int) error {
	lev := max(1, min(125, leverage))
	_, err := c.signedRequest(ctx, "POST", "/fapi/v1/leverage", map[string]string{
		"symbol":   symbol,
		"leverage": strconv.Itoa(lev),
	})
	return err // ignore if already set
}

func (c *Client) GetPosition(ctx context.Context, symbol string) (*PositionInfo, error) {
	data, err := c.signedRequest(ctx, "GET", "/fapi/v2/positionRisk", map[string]string{"symbol": symbol})
	if err != nil {
		return nil, err
	}
	amt := getFloat(data, "positionAmt")
	if math.Abs(amt) < 1e-8 {
		return nil, nil
	}
	return &PositionInfo{
		Symbol:           getString(data, "symbol"),
		PositionAmt:      amt,
		EntryPrice:       getFloat(data, "entryPrice"),
		MarkPrice:        getFloat(data, "markPrice"),
		UnrealizedProfit: getFloat(data, "unrealizedProfit"),
		Leverage:         getFloat(data, "leverage"),
	}, nil
}

func (c *Client) GetBalance(ctx context.Context) (*AccountInfo, error) {
	data, err := c.signedRequest(ctx, "GET", "/fapi/v2/account", nil)
	if err != nil {
		return nil, err
	}
	return &AccountInfo{
		TotalWalletBalance: getFloat(data, "totalWalletBalance"),
		UnrealizedProfit:   getFloat(data, "totalUnrealizedProfit"),
		AvailableBalance:   getFloat(data, "availableBalance"),
	}, nil
}

func (c *Client) TestConnection(ctx context.Context) bool {
	_, err := c.GetBalance(ctx)
	return err == nil
}

func (c *Client) GetCurrentPrice(ctx context.Context, symbol string) (float64, error) {
	data, err := c.publicGet(ctx, "/fapi/v1/ticker/price", map[string]string{"symbol": symbol})
	if err != nil {
		return 0, err
	}
	return getFloat(data, "price"), nil
}

func (c *Client) CalcQuantity(marginUsd, leverage, price float64) float64 {
	return (marginUsd * leverage) / price
}

func isAlreadySet(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return contains(msg, "-4060") || contains(msg, "Already") || contains(msg, "No need")
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsAny(s, sub))
}

func containsAny(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func getFloat(m map[string]interface{}, key string) float64 {
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return val
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	case json.Number:
		f, _ := val.Float64()
		return f
	}
	return 0
}

func getString(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	}
	return ""
}
