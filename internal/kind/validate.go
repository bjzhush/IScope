package kind

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"
)

// FieldErrors maps a field path (e.g. "attrs.context_window") to a message.
type FieldErrors map[string]string

const attrsPrefix = "attrs."

// ValidateAttrs checks attrs against fields and returns a cleaned copy.
// Empty values (nil, blank strings, empty arrays) count as absent and are
// dropped, so clearing an optional input never fails validation.
// Numbers may be json.Number (decoder with UseNumber) or Go numeric types.
func ValidateAttrs(fields []Field, attrs map[string]any) (map[string]any, FieldErrors) {
	byKey := make(map[string]Field, len(fields))
	for _, f := range fields {
		byKey[f.Key] = f
	}
	out := make(map[string]any, len(attrs))
	errs := FieldErrors{}

	for k, v := range attrs {
		f, ok := byKey[k]
		if !ok {
			errs[attrsPrefix+k] = "未定义的字段"
			continue
		}
		if isEmpty(v) {
			continue
		}
		norm, msg := checkValue(f, v)
		if msg != "" {
			errs[attrsPrefix+k] = msg
			continue
		}
		out[k] = norm
	}
	for _, f := range fields {
		if _, ok := out[f.Key]; f.Required && !ok && errs[attrsPrefix+f.Key] == "" {
			errs[attrsPrefix+f.Key] = "必填"
		}
	}
	if len(errs) > 0 {
		return nil, errs
	}
	return out, nil
}

func isEmpty(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(x) == ""
	case []any:
		return len(x) == 0
	case []string:
		return len(x) == 0
	}
	return false
}

func checkValue(f Field, v any) (any, string) {
	switch f.Type {
	case FieldText, FieldTextarea:
		s, ok := v.(string)
		if !ok {
			return nil, "必须是文本"
		}
		return s, ""

	case FieldNumber:
		n, ok := toFloat(v)
		if !ok {
			return nil, "必须是数字"
		}
		if f.Integer && n != math.Trunc(n) {
			return nil, "必须是整数"
		}
		if f.Min != nil && n < *f.Min {
			return nil, fmt.Sprintf("不能小于 %s", formatNum(*f.Min))
		}
		if f.Integer {
			return int64(n), ""
		}
		return n, ""

	case FieldBool:
		b, ok := v.(bool)
		if !ok {
			return nil, "必须是布尔值"
		}
		return b, ""

	case FieldSelect:
		s, ok := v.(string)
		if !ok || !hasOption(f, s) {
			return nil, "不是有效的选项"
		}
		return s, ""

	case FieldMultiSelect:
		list, ok := toStrings(v)
		if !ok {
			return nil, "必须是选项数组"
		}
		seen := map[string]bool{}
		for _, s := range list {
			if !hasOption(f, s) {
				return nil, fmt.Sprintf("包含无效的选项 %q", s)
			}
			if seen[s] {
				return nil, fmt.Sprintf("选项 %q 重复", s)
			}
			seen[s] = true
		}
		return list, ""

	case FieldDate:
		s, ok := v.(string)
		if !ok {
			return nil, "日期格式应为 YYYY-MM-DD"
		}
		if _, err := time.Parse(time.DateOnly, s); err != nil {
			return nil, "日期格式应为 YYYY-MM-DD"
		}
		return s, ""

	case FieldURL:
		s, ok := v.(string)
		if !ok || !ValidURL(s) {
			return nil, "必须是 http 或 https 链接"
		}
		return s, ""
	}
	return nil, "不支持的字段类型"
}

// ValidURL reports whether s is an absolute http(s) URL with a host.
func ValidURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func hasOption(f Field, v string) bool {
	for _, o := range f.Options {
		if o.Value == v {
			return true
		}
	}
	return false
}

func toFloat(v any) (float64, bool) {
	var n float64
	switch x := v.(type) {
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return 0, false
		}
		n = f
	case float64:
		n = x
	case float32:
		n = float64(x)
	case int:
		n = float64(x)
	case int64:
		n = float64(x)
	default:
		return 0, false
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

func toStrings(v any) ([]string, bool) {
	switch x := v.(type) {
	case []string:
		return x, true
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			s, ok := e.(string)
			if !ok {
				return nil, false
			}
			out = append(out, s)
		}
		return out, true
	}
	return nil, false
}

func formatNum(f float64) string {
	if f == math.Trunc(f) {
		return fmt.Sprintf("%d", int64(f))
	}
	return fmt.Sprintf("%g", f)
}
