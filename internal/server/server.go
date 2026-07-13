package server

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"hermesx/internal/backtest"
	"hermesx/internal/config"
	"hermesx/internal/store"
	"hermesx/internal/strategy"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Server struct {
	httpSrv *http.Server
	hub     *Hub
	engine  *strategy.Engine
	runner  *backtest.Runner
	store   *store.Store
	cfg     config.Config
}

func New(engine *strategy.Engine, runner *backtest.Runner, store *store.Store, cfg config.Config) *Server {
	s := &Server{
		hub:    NewHub(),
		engine: engine,
		runner: runner,
		store:  store,
		cfg:    cfg,
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	// Static files
	workDir, _ := os.Getwd()
	staticDir := filepath.Join(workDir, "web", "static")
	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	r.Handle("/style.css", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(workDir, "web", "style.css"))
	}))

	// API
	handlers := NewHandlers(engine, runner, store, cfg)
	handlers.Register(r)

	// WebSocket
	r.Get("/ws", s.hub.HandleWS)

	// Home — SSR with history
	r.Get("/", s.handleIndex)

	// Wire engine broadcast to WebSocket hub
	engine.SetBroadcast(func(state strategy.LiveState) {
		msg, err := json.Marshal(map[string]interface{}{
			"type":  "liveState",
			"state": state,
		})
		if err != nil {
			return
		}
		s.hub.PushState(msg)
	})

	s.httpSrv = &http.Server{
		Addr:    fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler: r,
	}

	return s
}

func (s *Server) ListenAndServe() error {
	// Start WebSocket hub
	go s.hub.Run()

	// Start engine
	go s.engine.Run(context.Background())

	// Print local IPs
	log.Printf("[server] listening on http://localhost:%d", s.cfg.Port)
	for _, ip := range getLanIPs() {
		log.Printf("[server] LAN access: http://%s:%d", ip, s.cfg.Port)
	}

	return s.httpSrv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

// Template view model for history items
type histItemView struct {
	ID               string
	Timestamp        string
	Symbol           string
	Days             string
	ReturnPctDisplay string
	ReturnColor      string
	StopCount        string
	OrderCount       string
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.List(50, 0)
	if err != nil || items == nil {
		items = []store.HistorySummary{}
	}

	view := make([]histItemView, len(items))
	for i, item := range items {
		sign := ""
		color := "#ef4444"
		if item.TotalReturnPct >= 0 {
			sign = "+"
			color = "#22c55e"
		}
		d := time.UnixMilli(item.Timestamp)
		timeStr := d.Format("2006-1-2 15:04")
		view[i] = histItemView{
			ID:               item.ID,
			Timestamp:        timeStr,
			Symbol:           item.Symbol,
			Days:             fmt.Sprintf("%dd", item.Days),
			ReturnPctDisplay: fmt.Sprintf("%s%.2f%%", sign, item.TotalReturnPct),
			ReturnColor:      color,
			StopCount:        fmt.Sprintf("SL:%d", item.StopCount),
			OrderCount:       fmt.Sprintf("Ord:%d", item.OrderCount),
		}
	}

	tmpl := template.Must(template.New("index").Parse(indexHTML))
	data := map[string]interface{}{
		"History": view,
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		log.Printf("[server] template error: %v", err)
	}
}

func getLanIPs() []string {
	var ips []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ips
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			ips = append(ips, ipnet.IP.String())
		}
	}
	return ips
}

func deadline() time.Time {
	return time.Now().Add(10 * time.Second)
}
