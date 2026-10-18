// Usage events (PostHog): what people build and edit, to improve LUT Studio. Never the game's files, project files,
// folder paths or anything typed outside mod names. Cookieless (no cookies or stored ids: PostHog counts daily
// visitors from a salted hash), no session replay, no autocapture: only the events named here. Off on a local server
// (localhost), in the tests (navigator.webdriver), without a key, and when the user switches it off (start page).

const KEY = 'phc_zoDvV733kdneFPFXRZ9uH8tyiQW67HgZmAghTNZAMaav';   // the PostHog project key (project 668968, US cloud); empty: off
const HOST = 'https://us.i.posthog.com';
const LIB = 'https://cdn.jsdelivr.net/npm/posthog-js@1.434.13/dist/module.mjs';
const OFF_KEY = 'lutstudio.analytics';             // localStorage: 'off' = the user switched it off

let ph = null, loading = null;
const queue = [];

export function analyticsAvailable() {
  return !!KEY && !/^(localhost|127\.|\[::1\])/.test(location.hostname) && !navigator.webdriver;
}
export function analyticsOn() {
  try { if (localStorage.getItem(OFF_KEY) === 'off') return false; } catch { }
  return analyticsAvailable();
}
export function setAnalytics(on) {
  try { localStorage.setItem(OFF_KEY, on ? 'on' : 'off'); } catch { }
  if (!on) ph?.opt_out_capturing();
  else if (ph) ph.opt_in_capturing();
  else start();
}

let blocked = false;   // (the library couldn't load, e.g. a blocker: no events kept)
function start() {
  if (loading || !analyticsOn()) return loading;
  loading = import(LIB).then(m => {
    if (!analyticsOn()) { queue.length = 0; loading = null; return; }   // (switched off while loading)
    ph = m.default;
    ph.init(KEY, {
      api_host: HOST, cookieless_mode: 'always', autocapture: false, capture_pageview: true, capture_pageleave: false,
      disable_session_recording: true, disable_surveys: true, advanced_disable_flags: true,
      person_profiles: 'identified_only',
    });
    for (const [e, p, now] of queue.splice(0)) ph.capture(e, p, now ? { send_instantly: true, transport: 'sendBeacon' } : undefined);
  }).catch(e => { console.warn('analytics', e); blocked = true; queue.length = 0; });   // (blocked: not tried again)
  return loading;
}

// track(event, props): one usage event. now: sent at once (before the page reloads, e.g. a project opening).
export function track(event, props = {}, now = false) {
  if (!analyticsOn() || blocked) return;
  const p = { ...props, version: window.lutstudioVersion ?? '' };
  if (ph) ph.capture(event, p, now ? { send_instantly: true, transport: 'sendBeacon' } : undefined);
  else { queue.push([event, p, now]); start(); }
}
// wait for queued events to go out (before a reload): at most ms
export async function flush(ms = 800) {
  if (!analyticsOn()) return;
  await Promise.race([loading, new Promise(r => setTimeout(r, ms))]);
}

// page errors as events (the message and where, no stack of user data)
export function trackErrors(page) {
  if (!analyticsOn()) return;
  addEventListener('error', e => track('error', { page, message: String(e.message ?? '').slice(0, 300), source: String(e.filename ?? '').split('/').pop() }));
  addEventListener('unhandledrejection', e => track('error', { page, message: String(e.reason?.message ?? e.reason ?? '').slice(0, 300) }));
}
