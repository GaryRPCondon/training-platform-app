-- Per-user vision LLM configuration for screenshot/photo plan import.
-- Vision is decoupled from the general LLM provider (DeepSeek, the general
-- default, has no image input), so it gets its own provider + optional model
-- override. Defaults to Google Gemini Flash (gemini-2.5-flash) for price.
alter table athletes
  add column if not exists preferred_vision_provider text not null default 'gemini',
  add column if not exists preferred_vision_model text;

comment on column athletes.preferred_vision_provider is
  'Vision-capable LLM provider for screenshot plan import (gemini|openai|anthropic). Decoupled from preferred_llm_provider.';
comment on column athletes.preferred_vision_model is
  'Optional model override for vision import. Null = provider default (e.g. gemini-2.5-flash).';
