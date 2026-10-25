// Package catalog reads the public models.dev catalog and imports a model's
// metadata (and optionally its price on one provider) into the board.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
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
	CanonicalID  string   `json:"-"`          // "lab/id", the same across providers
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
	// Resolved: q was a model page link that named exactly this one entry.
	Resolved bool `json:"resolved"`
}

// models.dev api.json shape (only the fields we use).
type rawProvider struct {
	ID     string              `json:"id"`
	Name   string              `json:"name"`
	API    string              `json:"api"`
	Doc    string              `json:"doc"`
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
	hosts     map[string][]string // host of a provider's api/doc URL -> provider ids
	fetchedAt time.Time
}

func NewSource(url string) *Source {
	return &Source{url: url, client: &http.Client{Timeout: 30 * time.Second}, now: time.Now}
}

func (s *Source) load(ctx context.Context) ([]Entry, []Provider, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refresh(ctx); err != nil {
		return nil, nil, err
	}
	return s.entries, s.providers, nil
}

// refresh refetches the catalog once the cache is older than an hour. The
// caller holds s.mu.
func (s *Source) refresh(ctx context.Context) error {
	if s.entries != nil && s.now().Sub(s.fetchedAt) < cacheTTL {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return fmt.Errorf("catalog request: %w", err)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return apperr.New(apperr.BadRequest, fmt.Sprintf("无法获取模型目录：%v", err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return apperr.New(apperr.BadRequest, fmt.Sprintf("模型目录返回 HTTP %d", resp.StatusCode))
	}
	var raw map[string]rawProvider
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxCatalog)).Decode(&raw); err != nil {
		return apperr.New(apperr.BadRequest, fmt.Sprintf("模型目录格式无法解析：%v", err))
	}
	s.entries, s.providers = flatten(raw)
	s.hosts = providerHosts(raw)
	s.fetchedAt = s.now()
	return nil
}

// providerHosts maps the host of each provider's api and doc URL ("www."
// dropped) to the provider ids that use it.
func providerHosts(raw map[string]rawProvider) map[string][]string {
	hosts := map[string][]string{}
	for key, p := range raw {
		id := p.ID
		if id == "" {
			id = key
		}
		seen := map[string]bool{}
		for _, u := range []string{p.API, p.Doc} {
			if h := hostOf(u); h != "" && !seen[h] {
				seen[h] = true
				hosts[h] = append(hosts[h], id)
			}
		}
	}
	for _, ids := range hosts {
		sort.Strings(ids)
	}
	return hosts
}

func hostOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
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
			e.CanonicalID = id + "/" + e.ModelID
			// canonical_model_id "anthropic/claude-x" names the vendor and its own id.
			if prefix, official, ok := strings.Cut(m.CanonicalModelID, "/"); ok {
				e.OfficialID = official
				e.CanonicalID = m.CanonicalModelID
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
//
// A model page link (models.dev or a provider's own site) as q resolves to
// that one model; a link that names no model falls back to searching its last
// path segment, within the link's provider when the host is known.
func (s *Source) Search(ctx context.Context, q, provider string) (SearchResult, error) {
	s.mu.Lock()
	if err := s.refresh(ctx); err != nil {
		s.mu.Unlock()
		return SearchResult{}, err
	}
	entries, providers, hosts := s.entries, s.providers, s.hosts
	s.mu.Unlock()

	if u, ok := parseLink(q); ok {
		if e, ok := resolve(entries, hosts, u); ok {
			return SearchResult{Providers: providers, Entries: []Entry{e}, Total: 1, Resolved: true}, nil
		}
		q = lastSegment(u)
		if ids := hosts[hostOf(u.String())]; len(ids) == 1 {
			provider = ids[0]
		}
	}
	return search(entries, providers, q, provider), nil
}

func search(entries []Entry, providers []Provider, q, provider string) SearchResult {
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
	return res
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

// parseLink accepts an http(s) URL with a host; anything else is a keyword.
func parseLink(q string) (*url.URL, bool) {
	q = strings.TrimSpace(q)
	if !strings.HasPrefix(q, "http://") && !strings.HasPrefix(q, "https://") {
		return nil, false
	}
	u, err := url.Parse(q)
	if err != nil || u.Hostname() == "" {
		return nil, false
	}
	return u, true
}

func pathSegments(u *url.URL) []string {
	var segs []string
	for _, s := range strings.Split(u.Path, "/") {
		if s != "" {
			segs = append(segs, s)
		}
	}
	return segs
}

func lastSegment(u *url.URL) string {
	segs := pathSegments(u)
	if len(segs) == 0 {
		return ""
	}
	return segs[len(segs)-1]
}

// resolve finds the one model a link names.
//   - models.dev/models/<lab>/<model>: the canonical id lab/model, preferring
//     the lab's own provider entry.
//   - a provider's site (its api or doc host): the longest of its model ids
//     that appears in the path as whole segments, so sub-pages such as
//     /anthropic/claude-x/providers still match.
func resolve(entries []Entry, hosts map[string][]string, u *url.URL) (Entry, bool) {
	host := hostOf(u.String())
	segs := pathSegments(u)
	if host == "models.dev" {
		if len(segs) < 3 || segs[0] != "models" {
			return Entry{}, false
		}
		lab, model := segs[1], segs[2]
		var hit *Entry
		for i, e := range entries {
			if e.ProviderID == lab && e.ModelID == model {
				return e, true
			}
			if hit == nil && e.CanonicalID == lab+"/"+model {
				hit = &entries[i]
			}
		}
		if hit != nil {
			return *hit, true
		}
		return Entry{}, false
	}

	ids := hosts[host]
	if len(ids) == 0 {
		return Entry{}, false
	}
	path := "/" + strings.Join(segs, "/") + "/"
	var best *Entry
	for i, e := range entries {
		if !slices.Contains(ids, e.ProviderID) || !strings.Contains(path, "/"+e.ModelID+"/") {
			continue
		}
		if best == nil || len(e.ModelID) > len(best.ModelID) {
			best = &entries[i]
		}
	}
	if best == nil {
		return Entry{}, false
	}
	return *best, true
}
