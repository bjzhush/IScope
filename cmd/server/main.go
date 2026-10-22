package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bjzhush/ai-overview/internal/board"
	"github.com/bjzhush/ai-overview/internal/config"
	"github.com/bjzhush/ai-overview/internal/httpx"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/seed"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/web"
)

func main() {
	if err := run(); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sqldb, err := store.Open(ctx, cfg.DB)
	if err != nil {
		return err
	}
	defer sqldb.Close()

	reg := kind.Default()
	items := item.NewService(sqldb, reg)
	relations := relation.NewService(sqldb, reg)
	if cfg.Seed {
		return seed.Run(ctx, items, relations)
	}

	srv := &http.Server{Addr: cfg.Addr, Handler: newHandler(reg, items, relations), ReadHeaderTimeout: 5 * time.Second}
	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Addr, "db", cfg.DB)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

func newHandler(reg *kind.Registry, items *item.Service, relations *relation.Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	reg.Register(mux)
	item.NewHandler(items, relations).Register(mux)
	relation.NewHandler(relations).Register(mux)
	board.NewHandler(board.NewService(reg, items, relations)).Register(mux)
	mux.HandleFunc("/api/", httpx.NotFoundAPI)
	mux.Handle("/", httpx.SPA(web.Dist()))
	return httpx.Recover(httpx.Logging(mux))
}
