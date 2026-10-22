package httpx

import (
	"log/slog"
	"net/http"

	"github.com/bjzhush/ai-overview/internal/apperr"
)

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

var statusByCode = map[apperr.Code]int{
	apperr.BadRequest:       http.StatusBadRequest,
	apperr.ValidationFailed: http.StatusBadRequest,
	apperr.NotFound:         http.StatusNotFound,
	apperr.Conflict:         http.StatusConflict,
}

// WriteError renders err in the unified error format. Unknown errors become a
// 500 with no internal detail; the detail goes to the log.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	if e, ok := apperr.As(err); ok {
		if status, ok := statusByCode[e.Code]; ok {
			Write(w, status, errorBody{errorDetail{string(e.Code), e.Message, e.Fields}})
			return
		}
	}
	slog.Error("internal error", "method", r.Method, "path", r.URL.Path, "err", err)
	Write(w, http.StatusInternalServerError, errorBody{errorDetail{"internal", "服务器内部错误", nil}})
}

// NotFoundAPI answers unmatched /api/ paths with a JSON 404.
func NotFoundAPI(w http.ResponseWriter, r *http.Request) {
	WriteError(w, r, apperr.New(apperr.NotFound, "接口不存在"))
}
