// Package fsutil holds small file helpers shared by the packages that persist
// the app's state.
package fsutil

import (
	"os"
	"path/filepath"
	"time"
)

// WriteFileAtomic writes data to path so that a crash or power loss leaves
// either the old file or the new one, never a truncated mix: the data goes to a
// temporary file in the same folder, is flushed, and then replaces path.
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, perm); err != nil {
		return err
	}

	var renErr error
	for attempt := 0; attempt < 8; attempt++ {
		renErr = os.Rename(tmp, path)
		if renErr == nil {
			ok = true
			return nil
		}
		if attempt >= 2 {
			_ = os.Remove(path)
		}
		time.Sleep(time.Duration(10*(attempt+1)) * time.Millisecond)
	}
	return renErr
}
