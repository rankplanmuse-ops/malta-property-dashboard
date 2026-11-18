// Malta Property Dashboard (standalone) - public client configuration.
// Backend: Cloudflare Worker API (auth + verdicts) backed by Workers KV.
// Set API_BASE to "" to run without accounts (verdicts stay on this device).
window.APP_CONFIG = {
  API_BASE: "https://malta-dashboard-api.projects-hf5.workers.dev"
};
