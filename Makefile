BIN    := bin/ai-overview
SQLC   := go tool -modfile=tools/go.mod sqlc
PLACEHOLDER := web/dist/index.html

.PHONY: dev gen seed test build

# Run the Go server (:8080) and Vite (:5173) together; Ctrl-C stops both.
dev: $(PLACEHOLDER)
	@trap 'kill 0' EXIT; \
	go run ./cmd/server & \
	(cd web && npm run dev) & \
	wait

gen:
	$(SQLC) generate

seed:
	go run ./cmd/server -seed

test: $(PLACEHOLDER)
	go test ./...
	@if [ -d web/node_modules ]; then cd web && npx vitest run; fi

build:
	cd web && npm ci && npm run build
	go build -o $(BIN) ./cmd/server

# go:embed needs at least one file in web/dist; dist is not committed.
$(PLACEHOLDER):
	@mkdir -p web/dist
	@echo '<!doctype html><title>ai-overview</title><p>Frontend not built. Use make dev (port 5173) or make build.</p>' > $@
