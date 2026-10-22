package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/bjzhush/ai-overview/internal/store/db"
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
