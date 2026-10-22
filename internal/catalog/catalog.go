// Package catalog reads the public models.dev catalog and imports a model's
// metadata (and optionally its price on one provider) into the board.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/bjzhush/ai-overview/internal/apperr"
)

const (
	cacheTTL   = time.Hour
	maxCatalog = 64 << 20
	maxResults = 50
)

// Entry is one model as offered by one catalog provider.
type Entry struct {
	ProviderID   string   `json:"providerId"`
	ProviderName string   `json:"providerName"`
	ModelID      string   `json:"modelId"`    // this provider's id for the model
	OfficialID   string   `json:"officialId"` // the vendor's own id, from canonical_model_id
	Name         string   `json:"name"`
	Vendor       string   `json:"vendor"`
	ReleaseDate  string   `json:"releaseDate,omitempty"`
	Context      int64    `json:"context,omitempty"`
	Output       int64    `json:"output,omitempty"`
	Modalities   []string `json:"modalities"`
	InputPrice   *float64 `json:"inputPrice,omitempty"`  // USD per million tokens
	OutputPrice  *float64 `json:"outputPrice,omitempty"` // USD per million tokens
}

type Provider struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type SearchResult struct {
	Providers []Provider `json:"providers"`
	Entries   []Entry    `json:"entries"`
	Total     int        `json:"total"`
}

// models.dev api.json shape (only the fields we use).
type rawProvider struct {
	ID     string              `json:"id"`
	Name   string              `json:"name"`
	Models map[string]rawModel `json:"models"`
}

type rawModel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ReleaseDate string `json:"release_date"`
	Modalities  struct {
		Input []string `json:"input"`
	} `json:"modalities"`
	Limit struct {
		Context float64 `json:"context"`
		Output  float64 `json:"output"`
	} `json:"limit"`
	Cost *struct {
		Input  *float64 `json:"input"`
		Output *float64 `json:"output"`
	} `json:"cost"`
	CanonicalModelID string `json:"canonical_model_id"`
}

// Source fetches and caches the catalog.
type Source struct {
	url    string
	client *http.Client
	now    func() time.Time

	mu        sync.Mutex
	entries   []Entry
	providers []Provider
	fetchedAt time.Time
}

func NewSource(url string) *Source {
	return &Source{url: url, client: &http.Client{Timeout: 30 * time.Second}, now: time.Now}
}

func (s *Source) load(ctx context.Context) ([]Entry, []Provider, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries != nil && s.now().Sub(s.fetchedAt) < cacheTTL {
		return s.entries, s.providers, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("catalog request: %w", err)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, nil, apperr.New(apperr.BadRequest, fmt.Sprintf("无法获取模型目录：%v", err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, apperr.New(apperr.BadRequest, fmt.Sprintf("模型目录返回 HTTP %d", resp.StatusCode))
	}
	var raw map[string]rawProvider
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxCatalog)).Decode(&raw); err != nil {
		return nil, nil, apperr.New(apperr.BadRequest, fmt.Sprintf("模型目录格式无法解析：%v", err))
	}
	s.entries, s.providers = flatten(raw)
	s.fetchedAt = s.now()
	return s.entries, s.providers, nil
}

func flatten(raw map[string]rawProvider) ([]Entry, []Provider) {
	names := make(map[string]string, len(raw))
	for key, p := range raw {
		names[key] = p.Name
	}
	var entries []Entry
	var providers []Provider
	for key, p := range raw {
		id := p.ID
		if id == "" {
			id = key
		}
		for mkey, m := range p.Models {
			e := Entry{
				ProviderID: id, ProviderName: p.Name, ModelID: m.ID, Name: m.Name,
				ReleaseDate: m.ReleaseDate, Context: int64(m.Limit.Context), Output: int64(m.Limit.Output),
				Modalities: m.Modalities.Input, Vendor: p.Name,
			}
			if e.ModelID == "" {
				e.ModelID = mkey
			}
			if e.Name == "" {
				e.Name = e.ModelID
			}
			if e.Modalities == nil {
				e.Modalities = []string{}
			}
			e.OfficialID = e.ModelID
			// canonical_model_id "anthropic/claude-x" names the vendor and its own id.
			if prefix, official, ok := strings.Cut(m.CanonicalModelID, "/"); ok {
				e.OfficialID = official
				if n := names[prefix]; n != "" {
					e.Vendor = n
				} else {
					e.Vendor = prefix
				}
			}
			if m.Cost != nil {
				e.InputPrice, e.OutputPrice = m.Cost.Input, m.Cost.Output
			}
			entries = append(entries, e)
		}
		if len(p.Models) > 0 {
			providers = append(providers, Provider{ID: id, Name: p.Name, Count: len(p.Models)})
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.ProviderName != b.ProviderName {
			return a.ProviderName < b.ProviderName
		}
		return a.Name < b.Name
	})
	sort.Slice(providers, func(i, j int) bool { return providers[i].Name < providers[j].Name })
	return entries, providers
}

// Search filters by provider id and a case-insensitive keyword over the model
// name, model id and provider name. At most 50 entries are returned.
func (s *Source) Search(ctx context.Context, q, provider string) (SearchResult, error) {
	entries, providers, err := s.load(ctx)
	if err != nil {
		return SearchResult{}, err
	}
	q = strings.ToLower(strings.TrimSpace(q))
	res := SearchResult{Providers: providers, Entries: []Entry{}}
	for _, e := range entries {
		if provider != "" && e.ProviderID != provider {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(e.Name+" "+e.ModelID+" "+e.ProviderName), q) {
			continue
		}
		res.Total++
		if len(res.Entries) < maxResults {
			res.Entries = append(res.Entries, e)
		}
	}
	return res, nil
}

func (s *Source) Find(ctx context.Context, provider, modelID string) (Entry, error) {
	entries, _, err := s.load(ctx)
	if err != nil {
		return Entry{}, err
	}
	for _, e := range entries {
		if e.ProviderID == provider && e.ModelID == modelID {
			return e, nil
		}
	}
	return Entry{}, apperr.New(apperr.NotFound, "目录中没有这个模型")
}
