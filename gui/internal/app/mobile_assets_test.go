package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"phonegyro/web"
)

func TestMobileAssets(t *testing.T) {
	h := mobileAssets(web.Assets)

	get := func(path, enc, etag string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if enc != "" {
			req.Header.Set("Accept-Encoding", enc)
		}
		if etag != "" {
			req.Header.Set("If-None-Match", etag)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	// The build segment is ignored; the font is served as is, cached for good.
	font := get("/m/2.0.0.1-dev/Onest-Regular.woff2", "gzip", "")
	if font.Code != 200 || font.Header().Get("Content-Type") != "font/woff2" || font.Header().Get("Content-Encoding") != "" {
		t.Fatalf("font: %d %v", font.Code, font.Header())
	}
	if cc := font.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q", cc)
	}

	// The texture is gzipped for clients that accept it, plain for the rest.
	svg := get("/m/x/rings-dark.svg", "gzip, deflate", "")
	plain := get("/m/x/rings-dark.svg", "", "")
	if svg.Header().Get("Content-Encoding") != "gzip" || svg.Body.Len() >= plain.Body.Len() || plain.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("svg: gz %d bytes, plain %d bytes, %v", svg.Body.Len(), plain.Body.Len(), plain.Header())
	}

	// Revalidation and unknown names.
	if rec := get("/m/x/grain-dark.png", "", font.Header().Get("ETag")); rec.Code != 200 {
		t.Fatalf("another file's ETag must not match: %d", rec.Code)
	}
	png := get("/m/x/grain-dark.png", "", "")
	if rec := get("/m/x/grain-dark.png", "", png.Header().Get("ETag")); rec.Code != http.StatusNotModified {
		t.Fatalf("matching ETag: %d, want 304", rec.Code)
	}
	if rec := get("/m/x/nope.woff2", "", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown file: %d", rec.Code)
	}
}
