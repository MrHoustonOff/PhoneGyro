package app

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"phonegyro/pkg/server"
	"phonegyro/web"
)

// The phone page (web/index.html) is one file; its fonts and textures live under
// /m/<build>/<file>. The build in the path is the app's version (SetAppVersion
// writes it into the page), so a new build never meets an old cached file and
// the files can be cached for good. Text assets are gzipped once, here.

type mobileAsset struct {
	body, gz []byte
	ctype    string
	etag     string
}

func mobileAssets(fsys fs.FS) http.Handler {
	files := map[string]mobileAsset{}
	entries, _ := fs.ReadDir(fsys, "assets")
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := fs.ReadFile(fsys, path.Join("assets", e.Name()))
		if err != nil {
			continue
		}
		sum := sha256.Sum256(data)
		a := mobileAsset{body: data, ctype: mime.TypeByExtension(path.Ext(e.Name())), etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
		if strings.HasSuffix(e.Name(), ".svg") {
			a.ctype = "image/svg+xml"
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(data)
			zw.Close()
			if buf.Len() < len(data) {
				a.gz = buf.Bytes()
			}
		}
		if strings.HasSuffix(e.Name(), ".woff2") {
			a.ctype = "font/woff2"
		}
		files[e.Name()] = a
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/m/")
		if i := strings.IndexByte(name, '/'); i >= 0 {
			name = name[i+1:] // drop the build segment
		}
		a, ok := files[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Content-Type", a.ctype)
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
		h.Set("ETag", a.etag)
		h.Set("Vary", "Accept-Encoding")
		if r.Header.Get("If-None-Match") == a.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		body := a.body
		if a.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			h.Set("Content-Encoding", "gzip")
			body = a.gz
		}
		w.Write(body)
	})
}

// serveMobileAssets adds the phone page's fonts and textures to the HTTPS server.
func (a *App) serveMobileAssets(srv *server.Server) {
	srv.HTTPSMux.Handle("/m/", mobileAssets(web.Assets))
}
