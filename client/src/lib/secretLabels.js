/** Platform-wide keys (not tied to a single agent's env_required). */
export const PLATFORM_SECRET_KEYS = ['LLM_ROUTER_URL'];

export const SECRET_LABELS = {
  LLM_ROUTER_URL: 'Router Base URL',
  ANTHROPIC_API_KEY: 'Anthropic API Key',
  OPENAI_API_KEY: 'OpenAI API Key',
  KIMI_API_KEY: 'Kimi API Key',
  AMP_API_KEY: 'AMP API Key',
  COHERE_API_KEY: 'Cohere API Key',
  HERMES_API_KEY: 'Hermes API Key',
  OPENCLAW_KEY: 'OpenClaw API Key',
};

export function getSecretLabel(key) {
  if (SECRET_LABELS[key]) return SECRET_LABELS[key];
  return key
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function isSecretPasswordField(key) {
  return /KEY|TOKEN|SECRET/i.test(key);
}
