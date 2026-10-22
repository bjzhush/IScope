// Package apperr defines domain errors that httpx maps to HTTP responses.
package apperr

import (
	"errors"
	"sort"
	"strings"
)

type Code string

const (
	BadRequest       Code = "bad_request"
	ValidationFailed Code = "validation_failed"
	NotFound         Code = "not_found"
	Conflict         Code = "conflict"
)

type Error struct {
	Code    Code
	Message string
	Fields  map[string]string // field path -> message
}

func (e *Error) Error() string {
	if len(e.Fields) == 0 {
		return string(e.Code) + ": " + e.Message
	}
	keys := make([]string, 0, len(e.Fields))
	for k := range e.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = k + "=" + e.Fields[k]
	}
	return string(e.Code) + ": " + e.Message + " [" + strings.Join(parts, ", ") + "]"
}

func New(code Code, msg string) *Error { return &Error{Code: code, Message: msg} }

func Validation(fields map[string]string) *Error {
	return &Error{Code: ValidationFailed, Message: "请检查标出的字段", Fields: fields}
}

// As extracts an *Error from err's chain.
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

// Is reports whether err carries the given code.
func Is(err error, code Code) bool {
	e, ok := As(err)
	return ok && e.Code == code
}
