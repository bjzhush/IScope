package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/bjzhush/ai-overview/internal/store/db"
)

// WithTx runs fn in a transaction, committing on nil error and rolling back otherwise.
func WithTx(ctx context.Context, sqldb *sql.DB, fn func(q *db.Queries) error) error {
	tx, err := sqldb.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	if err := fn(db.New(tx)); err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
