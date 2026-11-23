# OpenAI API: what HQ relies on (verified 23 November 2026)

Checked against OpenAI's official documentation (Markdown versions, `.md` appended to each page):

- Models: https://developers.openai.com/api/docs/models , https://developers.openai.com/api/docs/models/gpt-6-luna , https://developers.openai.com/api/docs/models/gpt-image-2.6-flare
- Pricing: https://developers.openai.com/api/docs/pricing
- Responses: https://developers.openai.com/api/reference/resources/responses/methods/create
- Images: https://developers.openai.com/api/reference/resources/images/methods/generate , https://developers.openai.com/api/reference/resources/images/methods/edit
- Errors: https://developers.openai.com/api/docs/guides/error-codes

## Models (defaults, configurable)

| Use | Env var | Default | Notes from the model page |
| --- | --- | --- | --- |
| Text: Vektor, Quill, Cue, Calibre (wording), Vantage (interpretation) | `OPENAI_TEXT_MODEL` | `gpt-6-luna` | Responses API supported. `reasoning.effort`: none, low, medium (default), high, xhigh, max. 1,050,000 context, 128,000 max output. |
| Images: Prism | `OPENAI_IMAGE_MODEL` | `gpt-image-2.6-flare` | Image generation (`v1/images/generations`) and edit (`v1/images/edits`) supported. Not available in the Responses API. |

## Prices used for estimates (Standard tier, per 1M tokens)

| Model | Input | Cached input | Output |
| --- | --- | --- | --- |
| gpt-6-luna (text, ≤272K prompt) | $0.10 | $0.01 | $0.50 |
| gpt-image-2.6-flare, text tokens | $5.00 | $1.25 | – |
| gpt-image-2.6-flare, image tokens | $8.00 | $2.00 | $30.00 |

Estimates are list prices from that page. Your invoice is the source of truth. Override with `OPENAI_PRICES` (JSON) if prices change.

## Requests

Text: `POST https://api.openai.com/v1/responses` with `Authorization: Bearer $OPENAI_API_KEY`, JSON body `{ model, instructions, input, reasoning: { effort }, max_output_tokens, store: false, text: { format: { type: "json_schema", name, schema, strict: true } } }`. The reply is in `output[]` items of type `message`, whose `content[]` holds `output_text` (`text`) or `refusal` (`refusal`). `output_text` on the response object is an SDK-only convenience, so HQ reads `output[]`. `status` may be `incomplete` with `incomplete_details.reason` (e.g. `max_output_tokens`). Usage: `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`, `total_tokens`.

Image generation: `POST https://api.openai.com/v1/images/generations`, JSON `{ model, prompt, n: 1, size: "1024x1536", quality, output_format: "jpeg", output_compression }`. GPT image models always return `data[].b64_json`. Usage: `input_tokens`, `input_tokens_details.{text_tokens,image_tokens}`, `output_tokens`, `output_tokens_details.{image_tokens,text_tokens}`, `total_tokens`.

Image edit: `POST https://api.openai.com/v1/images/edits`, JSON (not multipart) `{ model, prompt, images: [{ image_url: "data:image/jpeg;base64,…" }], size, quality, output_format }`. The model defaults to `gpt-image-2.6-sunburst` unless set, so HQ always sends the configured model.

Errors: 401 invalid key; 403 unsupported region; 429 rate limit, `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`; 5xx server errors.

## How HQ protects spend

- **Owner only.** Paid endpoints (`/api/quill/caption`, `/api/vektor/plan`, `/api/video/script`, `/api/review/wording`, `/api/analyst/interpret`, `/api/prism/image`) run live only when `OPENAI_API_KEY` is set **and** owner sign-in is configured (`HQ_OWNER_PASSWORD_HASH`) **and** the request carries a signed-in owner session. A key without owner sign-in returns 403 `owner_signin_required`; a signed-out visitor gets 401. `/api/quill/status` reports demo mode to anyone who can't spend. The Vercel preview has no owner sign-in, so it stays in demo mode even if a key were set there.
- **Explicit actions only.** Requests start from a tap: submitting a brief, sending a revision, Generate image / Edit image, AI wording review, AI interpretation, Draft with AI. Nothing polls OpenAI.
- **One charge per action.** Every live request needs a `requestKey` (made when you tap, saved with the job). The server keeps in-flight and completed results for six hours: a double tap, a second device, a refresh or a retry after a lost reply returns the first result (`duplicate: true`) and is logged as "no new charge". Failed requests aren't cached, so an explicit retry makes one new request.
- **Usage.** Each response's `usage` is stored on the job (`aiUsage`) and in `ai-usage.json` (numbers only) with an estimated cost from the prices above. Failed requests that still report usage (refusal, cut-off, invented figure) are recorded too.
- **Layout is free.** Prism's generated picture is stored once; the official logo, headline, crop and position are applied by the local Photo layout renderer, so changing them never calls OpenAI.
