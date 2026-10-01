The status capsule shows the phone/controller link state in the header: a dot wrapped in a thin ring, then a lowercase mono word.

```html
<span class="pg-status pg-status--online"><span class="pg-status__dot"></span>online</span>
```

**States**
| class | dot | meaning |
| --- | --- | --- |
| `pg-status--online` | `accent`, ring pings every 2.2s | phone streaming |
| (none) | `danger` | offline |
| `pg-status--paused` | `warn` | paused from phone |
| `pg-status--usb` | `info` on `info-soft` capsule | waiting for USB controller |

**Rules**
- The word is always present: state is never carried by colour alone.
- Text stays lowercase mono (`font-mono`, 13px). The ping animation stops under `prefers-reduced-motion`.

**Replaces:** `status-capsule.online|.offline|.paused|.waiting-usb` + `status-dot`.
