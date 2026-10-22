// Package config resolves runtime settings from flags and environment variables.
package config

import (
	"flag"
	"os"
)

const (
	DefaultAddr = "127.0.0.1:8080"
	DefaultDB   = "./data/overview.db"
	// DefaultCatalogURL is the public models.dev catalog used by 从 models.dev 导入.
	DefaultCatalogURL = "https://models.dev/api.json"

	EnvAddr       = "AI_OVERVIEW_ADDR"
	EnvDB         = "AI_OVERVIEW_DB"
	EnvCatalogURL = "AI_OVERVIEW_CATALOG_URL"
)

type Config struct {
	Addr       string
	DB         string
	CatalogURL string
	Seed       bool // write sample data and exit
}

// Load parses args (without the program name). Precedence: flag > env > default.
func Load(args []string) (Config, error) {
	fs := flag.NewFlagSet("ai-overview", flag.ContinueOnError)
	var c Config
	fs.StringVar(&c.Addr, "addr", envOr(EnvAddr, DefaultAddr), "listen address (env "+EnvAddr+")")
	fs.StringVar(&c.DB, "db", envOr(EnvDB, DefaultDB), "SQLite database path (env "+EnvDB+")")
	fs.StringVar(&c.CatalogURL, "catalog-url", envOr(EnvCatalogURL, DefaultCatalogURL), "model catalog JSON URL (env "+EnvCatalogURL+")")
	fs.BoolVar(&c.Seed, "seed", false, "write sample data and exit")
	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}
	return c, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
