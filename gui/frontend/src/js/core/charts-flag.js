// "Turn off rendering of all charts" (Settings → Performance): one flag, kept in localStorage, read by the stats
// page charts and by the filter-response graph. While it is on, nothing draws and the stats page's own "Charts"
// switch is forced off and locked.

const KEY = 'pg-charts-global-off';
const subs = [];
let off = false;
try { off = localStorage.getItem(KEY) === '1'; } catch (_) { /* session default */ }

export const chartsGloballyOff = () => off;
export const onChartsFlag = (fn) => subs.push(fn);

export function setChartsGloballyOff(v) {
  off = !!v;
  try { localStorage.setItem(KEY, off ? '1' : '0'); } catch (_) { /* session only */ }
  for (const fn of subs) fn(off);
}
