export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.5'

// Without `/v1`, like the Anthropic SDK's own baseURL; the OpenAI SDK's includes it.
export const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

// OpenAI and Anthropic both reject longer tool names.
export const MAX_TOOL_NAME_LENGTH = 64
