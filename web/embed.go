// Package web embeds the built frontend. `make dev`/`make build` ensure dist
// holds at least a placeholder index.html so this always compiles.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the build output rooted at dist/.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
