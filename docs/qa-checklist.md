# Manual QA Checklist

Run this checklist before production deploy.

## 1) Environment + security

1. Confirm all required env vars are set in deployment target.
2. Verify `/study` response includes:
   - `Content-Security-Policy: frame-ancestors <expected ancestors>;`
   - `Referrer-Policy: strict-origin-when-cross-origin`
3. Verify `/ext/<topic>/<slug>` response includes the same headers.
4. Confirm admin endpoints reject missing/wrong bearer token.

## 2) Condition reachability

For each condition (`vanilla_search`, `injected_search`, `vanilla_agent`, `injected_agent`):

1. Open `/study?participant_id=<id>&condition=<cond>&token=<signed>`.
2. Confirm consent shows expected topic text.
3. Start condition and complete flow.
4. Confirm completion screen appears and code is displayed.

## 3) Injected search behavior

1. Under `injected_search`, submit a query on page 1:
   - Confirm injected source appears exactly once on page 1.
2. Move to page 2+:
   - Confirm no injected source appears.
3. Click injected source:
   - Confirm landing page `/ext/...` renders.
   - Confirm `malicious_source_clicked` event recorded.

## 4) Agent streaming behavior

1. Under `vanilla_agent` and `injected_agent`, start simulation.
2. Confirm activity panel updates incrementally (not batched all-at-once).
3. Confirm report token stream appears progressively.
4. Use **Skip simulation**:
   - Confirm report resolves quickly to full content.
   - Confirm `agent_skip_used` event recorded.

## 5) Chat behavior

1. After agent report completion, send a user message.
2. Confirm assistant stream renders token-by-token.
3. Send at least one additional turn.
4. Under injected condition, verify pinned context remains injected across turns
   (manual qualitative check).

## 6) Iframe completion handoff

1. In embedded survey page, listen for `postMessage`.
2. Complete study in iframe.
3. Confirm `study_complete` message payload includes:
   - `participant_id`
   - `completion_code`
   - `duration_ms`
4. Confirm code is captured in survey field / handoff logic.

## 7) Data export + analysis sanity checks

1. Export CSV from:
   - `/api/admin/export?table=sessions&format=csv`
   - `/api/admin/export?table=events&format=csv`
   - `/api/admin/export?table=chat_messages&format=csv`
2. Open in analysis notebook.
3. Confirm no broken CSV rows and expected headers.
4. Confirm formula-looking values are prefixed/neutralized.

## 8) Distribution sanity

Run a quick dry run with ~40 test participant IDs.

1. Confirm condition distribution is roughly balanced.
2. Confirm each session has expected event families for its condition.
3. Confirm sessions complete with stable completion-code issuance.
