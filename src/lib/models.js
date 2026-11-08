// Model choices, kept separate so the app can show them without loading the Claude library.
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most accurate)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, half the cost)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
