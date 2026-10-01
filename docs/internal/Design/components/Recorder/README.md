The recorder captures a telemetry CSV with a start/stop button, a running timer, a progress bar to the time limit and a rows/size counter.

```html
<div class="pg-card"><div class="pg-rec">
  <div class="pg-rec__top"><button class="pg-btn"><span class="pg-rec__dot"></span>Start Recording</button><div class="pg-rec__time">00:00 <small>/ 01:00</small></div></div>
  <div class="pg-progress"><i style="--p:0%"></i></div>
  <div class="pg-rec__meta"><span>0 rows · 0 KB</span><span class="pg-badge">Limit: 1 min</span></div>
</div></div>
```

**Rules**
- Idle: secondary button with a 9px `danger` dot. Recording: `pg-btn--danger` "Stop recording" and a `REC` danger badge; the timer counts up in `mono` 22px.
- Progress fills with `accent` up to the limit; set it via `--p`.
- Localise the counter unit ("строк" / "rows") through i18n; the design does not change.
