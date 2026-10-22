// Package httpx provides JSON I/O, unified error responses and middleware.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/bjzhush/ai-overview/internal/apperr"
)

const maxBody = 1 << 20

// HandlerFunc is an http handler that returns an error for WriteError to render.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// Handle adapts a HandlerFunc to http.HandlerFunc.
func Handle(fn HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			WriteError(w, r, err)
		}
	}
}

// Decode reads a single JSON value into v. Unknown fields are rejected, and
// numbers inside interface{} values decode as json.Number.
func Decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody))
	dec.UseNumber()
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return decodeError(err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return apperr.New(apperr.BadRequest, "请求体只能包含一个 JSON 值")
	}
	return nil
}

func decodeError(err error) error {
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) && typeErr.Field != "" {
		return apperr.Validation(map[string]string{typeErr.Field: "类型错误"})
	}
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		return apperr.New(apperr.BadRequest, "请求体过大")
	}
	if errors.Is(err, io.EOF) {
		return apperr.New(apperr.BadRequest, "请求体为空")
	}
	return apperr.New(apperr.BadRequest, fmt.Sprintf("JSON 无法解析: %v", err))
}

func Write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "err", err)
	}
}

func NoContent(w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }
