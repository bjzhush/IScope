package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"

	"github.com/bjzhush/ai-overview/internal/store/db"
	"github.com/bjzhush/ai-overview/internal/store/migrations"
)

func openTemp(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "nested", "test.db")
}

func TestOpenAppliesPragmasAndMigrations(t *testing.T) {
	ctx := context.Background()
	path := openTemp(t)
	sqldb, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()

	var fk int
	if err := sqldb.QueryRow("PRAGMA foreign_keys").Scan(&fk); err != nil || fk != 1 {
		t.Fatalf("foreign_keys = %d, err %v", fk, err)
	}
	var mode string
	if err := sqldb.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("journal_mode = %q, err %v", mode, err)
	}
	for _, name := range []string{"items", "relations", "idx_items_kind_slug", "idx_items_kind_status", "idx_relations_to"} {
		var n int
		if err := sqldb.QueryRow("SELECT count(*) FROM sqlite_master WHERE name = ?", name).Scan(&n); err != nil || n != 1 {
			t.Fatalf("schema object %s missing", name)
		}
	}

	// Reopening must be a no-op for migrations.
	sqldb.Close()
	sqldb, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	sqldb.Close()
}

func TestMigrationsDropHarnessFields(t *testing.T) {
	ctx := context.Background()
	raw, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	raw.SetMaxOpenConns(1)
	p, err := goose.NewProvider(goose.DialectSQLite3, raw, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 1); err != nil {
		t.Fatal(err)
	}
	const old = "2020-01-01T00:00:00Z"
	insert := `INSERT INTO items (id, kind, name, slug, attrs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
	rows := []struct{ id, kind, attrs string }{
		{"h1", "harness", `{"form":"cli","vendor":"A","open_source":false,"pricing":"byok","config_path":"~/x"}`},
		{"h2", "harness", `{"form":"ide"}`},
		{"m1", "model", `{"vendor":"A","pricing":"keep"}`}, // another kind is untouched
	}
	for _, r := range rows {
		if _, err := raw.ExecContext(ctx, insert, r.id, r.kind, r.id, r.id, r.attrs, old, old); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.UpTo(ctx, 2); err != nil {
		t.Fatal(err)
	}

	want := map[string]struct {
		attrs   string
		touched bool
	}{
		"h1": {`{"form":"cli","vendor":"A"}`, true},
		"h2": {`{"form":"ide"}`, false},
		"m1": {`{"vendor":"A","pricing":"keep"}`, false},
	}
	for id, w := range want {
		var attrs, updated string
		if err := raw.QueryRowContext(ctx, `SELECT attrs, updated_at FROM items WHERE id = ?`, id).Scan(&attrs, &updated); err != nil {
			t.Fatal(err)
		}
		if attrs != w.attrs {
			t.Errorf("%s attrs = %s, want %s", id, attrs, w.attrs)
		}
		if (updated != old) != w.touched {
			t.Errorf("%s updated_at = %s, touched want %v", id, updated, w.touched)
		}
	}

	// 0003: harness keeps no attrs at all; other kinds are untouched.
	if _, err := raw.ExecContext(ctx, `UPDATE items SET updated_at = ?`, old); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 3); err != nil {
		t.Fatal(err)
	}
	for id, wantAttrs := range map[string]string{"h1": `{}`, "h2": `{}`, "m1": `{"vendor":"A","pricing":"keep"}`} {
		var attrs, updated string
		if err := raw.QueryRowContext(ctx, `SELECT attrs, updated_at FROM items WHERE id = ?`, id).Scan(&attrs, &updated); err != nil {
			t.Fatal(err)
		}
		if attrs != wantAttrs || (updated != old) != (id != "m1") {
			t.Errorf("after 0003 %s: attrs %s updated_at %s", id, attrs, updated)
		}
	}
}

func TestWithTxRollsBack(t *testing.T) {
	ctx := context.Background()
	sqldb, err := Open(ctx, openTemp(t))
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()

	boom := errors.New("boom")
	err = WithTx(ctx, sqldb, func(q *db.Queries) error {
		if _, err := q.CreateItem(ctx, db.CreateItemParams{
			ID: "x", Kind: "model", Name: "X", Slug: "x", Status: "watching",
			Tags: "[]", Links: "[]", Attrs: "{}", CreatedAt: "t", UpdatedAt: "t",
		}); err != nil {
			t.Fatal(err)
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("got %v, want boom", err)
	}
	var n int
	if err := sqldb.QueryRow("SELECT count(*) FROM items").Scan(&n); err != nil || n != 0 {
		t.Fatalf("rows after rollback = %d, err %v", n, err)
	}
}
