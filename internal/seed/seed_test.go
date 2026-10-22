package seed

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
)

func TestRunIsIdempotent(t *testing.T) {
	ctx := context.Background()
	sqldb, err := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	reg := kind.Default()
	svc := item.NewService(sqldb, reg)
	rels := relation.NewService(sqldb, reg)

	for i := 0; i < 2; i++ {
		if err := Run(ctx, svc, rels); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		all, _ := svc.List(ctx, item.ListFilter{})
		if len(all) != len(samples) {
			t.Fatalf("run %d: %d items, want %d", i, len(all), len(samples))
		}
		live, _ := rels.ListLive(ctx)
		if len(live) != len(sampleLinks) {
			t.Fatalf("run %d: %d relations, want %d", i, len(live), len(sampleLinks))
		}
		types := map[string]bool{}
		for _, r := range live {
			types[r.Type] = true
		}
		if len(types) != 3 {
			t.Fatalf("relation types covered: %v", types)
		}
	}
}
