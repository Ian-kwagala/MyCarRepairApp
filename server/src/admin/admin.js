// Admin console behaviour. Served from the same origin so the default CSP (no inline scripts) stays intact.

// Ask before destructive actions: <form data-confirm="…">.
document.addEventListener('submit', (e) => {
  const msg = e.target instanceof HTMLFormElement ? e.target.dataset.confirm : undefined;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Live pages (<body data-refresh="30">) reload while visible, unless someone is typing.
const every = Number(document.body.dataset.refresh || 0);
if (every > 0) {
  setInterval(() => {
    const el = document.activeElement;
    const typing = el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    if (document.visibilityState === 'visible' && !typing) location.reload();
  }, every * 1000);
}
