package seed

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/store"
)

func TestRunIsIdempotent(t *testing.T) {
	ctx := context.Background()
	sqldb, err := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	svc := item.NewService(sqldb, kind.Default())

	for i := 0; i < 2; i++ {
		if err := Run(ctx, svc); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		all, _ := svc.List(ctx, item.ListFilter{})
		if len(all) != len(samples) {
			t.Fatalf("run %d: %d items, want %d", i, len(all), len(samples))
		}
	}
}
