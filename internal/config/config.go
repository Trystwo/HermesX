package config

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
)

func init() {
	loadDotEnv()
}

func loadDotEnv() {
	f, err := os.Open(".env")
	if err != nil {
		log.Printf("[config] no .env file: %v", err)
		return
	}
	log.Println("[config] loading .env")
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("[config] .env parse error: %v", err)
	}
}

type Config struct {
	Symbol               string
	InitialBalance       float64
	MarginRatio          float64
	Leverage             int
	FeeRate              float64
	StopLossPercent      float64
	TakeProfitPercent    float64
	PositionAmountValue  float64
	Interval             string
	Mode                 string
	Direction            string
	MockMode             bool
	Port                 int
	Host                 string
	BinanceWsURL         string
	BinanceAPIKey        string
	BinanceAPISecret     string
	BinanceTestnet       bool
	BinanceTestnetAPIKey string
	BinanceTestnetSecret string
	BinanceFapiBase      string
	BinanceTestnetBase   string
}

func Load() Config {
	cfg := Config{
		Symbol:              envStr("SYMBOL", "btcusdt"),
		InitialBalance:      envFloat("INITIAL_BALANCE", 1000),
		MarginRatio:         0.8,
		Leverage:            envInt("LEVERAGE", 3),
		FeeRate:             0.0002,
		StopLossPercent:     envFloat("STOP_LOSS_PCT", 0.03),
		TakeProfitPercent:   envFloat("TAKE_PROFIT_PCT", 0.05),
		PositionAmountValue: envFloat("POSITION_AMOUNT", 100),
		Interval:            envStr("INTERVAL", "1h"),
		Mode:                envStr("MODE", "sim"),
		Direction:            envStr("DIRECTION", "both"),
		MockMode:             os.Getenv("MOCK") == "true",
		Port:                 envInt("PORT", 3000),
		Host:                 envStr("HOST", "0.0.0.0"),
		BinanceAPIKey:        os.Getenv("BINANCE_API_KEY"),
		BinanceAPISecret:     os.Getenv("BINANCE_API_SECRET"),
		BinanceTestnet:       os.Getenv("BINANCE_TESTNET") == "true",
		BinanceTestnetAPIKey: os.Getenv("BINANCE_TESTNET_API_KEY"),
		BinanceTestnetSecret: os.Getenv("BINANCE_TESTNET_API_SECRET"),
		BinanceFapiBase:      "https://fapi.binance.com",
		BinanceTestnetBase:   "https://testnet.binancefuture.com",
	}

	if cfg.BinanceTestnet {
		cfg.BinanceWsURL = "wss://stream.binancefuture.com/ws"
	} else {
		cfg.BinanceWsURL = "wss://fstream.binance.com/ws"
	}

	return cfg
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return n
		}
	}
	return def
}
