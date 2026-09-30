// The app state (Go AppState): one source, many renderers. Each renderer gets
// the new and the previous state and writes only what it owns.

import { call, on } from './bridge.js';

let current = null;
/** How many states arrived (the debug panel's events per second). */
export const stateStats = { count: 0, lastAt: 0, maxGap: 0 }; // maxGap: longest wait between two states, reset by the reader
const subs = [];

/** Calls fn(state, prev) now (if the state is known) and on every change. */
export function onState(fn) {
  subs.push(fn);
  if (current) fn(current, null);
}

export const getState = () => current;

/** Applies a full state from Go (events, or a method that returns one). */
export function setState(st) {
  if (!st) return;
  stateStats.count++;
  const now = performance.now();
  if (stateStats.lastAt) stateStats.maxGap = Math.max(stateStats.maxGap, now - stateStats.lastAt);
  stateStats.lastAt = now;
  const prev = current;
  current = st;
  for (const fn of subs) fn(st, prev);
}

export async function startState() {
  on('state:change', setState);
  setState(await call('GetState'));
}
