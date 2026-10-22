package config

import "testing"

func TestLoadPrecedence(t *testing.T) {
	t.Setenv(EnvAddr, "")
	t.Setenv(EnvDB, "")
	t.Setenv(EnvCatalogURL, "")
	c, err := Load(nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != DefaultAddr || c.DB != DefaultDB || c.CatalogURL != DefaultCatalogURL || c.Seed {
		t.Fatalf("defaults: got %+v", c)
	}

	t.Setenv(EnvAddr, "127.0.0.1:9000")
	t.Setenv(EnvDB, "/tmp/env.db")
	c, _ = Load(nil)
	if c.Addr != "127.0.0.1:9000" || c.DB != "/tmp/env.db" {
		t.Fatalf("env: got %+v", c)
	}

	c, _ = Load([]string{"-addr", "127.0.0.1:9001", "-db", "/tmp/flag.db", "-catalog-url", "http://x/api.json", "-seed"})
	if c.Addr != "127.0.0.1:9001" || c.DB != "/tmp/flag.db" || c.CatalogURL != "http://x/api.json" || !c.Seed {
		t.Fatalf("flag: got %+v", c)
	}
}
