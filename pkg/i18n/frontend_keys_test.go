package i18n

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The UI (gui/frontend/src) names its strings by key; a key missing from a
// locale shows up as the raw key on screen. Every literal key the UI uses must
// exist in both ru.json and en.json, so removing a feature cannot leave a
// dangling reference, nor a translation dropped from one language only.

const frontendDir = "../../gui/frontend/src"

var (
	reT       = regexp.MustCompile(`\bt\(\s*'([a-z_]+\.[a-z0-9_]+)'`)
	reDataKey = regexp.MustCompile(`data-i18n(?:-title|-ph)?="([a-z_]+\.[a-z0-9_]+)"`)
)

func localeKeys(t *testing.T, lang string) map[string]bool {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("locales", lang+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var tree map[string]any
	if err := json.Unmarshal([]byte(strings.TrimPrefix(string(data), "\uFEFF")), &tree); err != nil {
		t.Fatalf("%s.json: %v", lang, err)
	}
	keys := map[string]bool{}
	var walk func(prefix string, m map[string]any)
	walk = func(prefix string, m map[string]any) {
		for k, v := range m {
			if sub, ok := v.(map[string]any); ok {
				walk(prefix+k+".", sub)
			} else {
				keys[prefix+k] = true
			}
		}
	}
	walk("", tree)
	return keys
}

func hasPrefix(keys map[string]bool, prefix string) bool {
	for k := range keys {
		if strings.HasPrefix(k, prefix) {
			return true
		}
	}
	return false
}

func frontendFiles(t *testing.T) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(frontendDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "vendor" || d.Name() == "docs" || d.Name() == "debug") {
			return filepath.SkipDir
		}
		if ext := filepath.Ext(p); ext == ".js" || ext == ".html" {
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		t.Skipf("frontend sources not found (%v)", err)
	}
	return files
}

func TestFrontendKeysExistInBothLocales(t *testing.T) {
	ru, en := localeKeys(t, "ru"), localeKeys(t, "en")
	files := frontendFiles(t)
	if len(files) < 10 {
		t.Fatalf("found only %d frontend files", len(files))
	}
	used := 0
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, re := range []*regexp.Regexp{reT, reDataKey} {
			for _, m := range re.FindAllStringSubmatch(string(data), -1) {
				used++
				k := m[1]
				if strings.HasSuffix(k, "_") {
					// a prefix completed at run time (t('ui.dsu_' + state)):
					// both locales must have keys under it
					if !hasPrefix(ru, k) || !hasPrefix(en, k) {
						t.Errorf("%s: no keys %s* in ru.json and en.json", f, k)
					}
					continue
				}
				if !ru[k] {
					t.Errorf("%s: key %q missing in ru.json", f, k)
				}
				if !en[k] {
					t.Errorf("%s: key %q missing in en.json", f, k)
				}
			}
		}
	}
	if used < 100 {
		t.Fatalf("found only %d key uses: the scan is broken", used)
	}
}

// The gyro auto-zero strip was removed in 2.1.1: nothing may still look for it.
func TestAutoZeroStripIsGone(t *testing.T) {
	ru, en := localeKeys(t, "ru"), localeKeys(t, "en")
	for _, k := range []string{"ui.bias_title", "ui.bias_tip", "ui.bias_moving", "ui.bias_rest", "ui.bias_updated"} {
		if ru[k] || en[k] {
			t.Errorf("locale key %s is still there", k)
		}
	}
	for _, f := range frontendFiles(t) {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, gone := range []string{"bias-meta", "bias-status", "bias-bar", "bias-val-", "biasAtRest", "biasRestProgress", "app-bias", "ui.bias_"} {
			if strings.Contains(string(data), gone) {
				t.Errorf("%s still refers to %q", f, gone)
			}
		}
	}
}

// Every element the device card script looks up by id is in the page.
func TestDeviceCardIDsExist(t *testing.T) {
	html, err := os.ReadFile(filepath.Join(frontendDir, "index.html"))
	if err != nil {
		t.Skipf("frontend sources not found (%v)", err)
	}
	js, err := os.ReadFile(filepath.Join(frontendDir, "js", "screens", "connect", "device.js"))
	if err != nil {
		t.Fatal(err)
	}
	ids := regexp.MustCompile(`\$\('([a-z0-9-]+)'\)`).FindAllStringSubmatch(string(js), -1)
	if len(ids) < 8 {
		t.Fatalf("found only %d lookups in device.js", len(ids))
	}
	for _, m := range ids {
		if !strings.Contains(string(html), `id="`+m[1]+`"`) {
			t.Errorf("device.js looks up #%s, which index.html does not have", m[1])
		}
	}
	// accel bars are looked up as 'accel-neg-' + axis
	for _, ax := range []string{"x", "y", "z"} {
		for _, p := range []string{"accel-neg-", "accel-pos-", "accel-val-"} {
			if !strings.Contains(string(html), `id="`+p+ax+`"`) {
				t.Errorf("index.html has no #%s%s", p, ax)
			}
		}
	}
}
