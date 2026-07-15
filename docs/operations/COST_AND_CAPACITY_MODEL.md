# Cost and Capacity Model

## Cost units

Do not reduce everything to one minute. Track:
- connected minute;
- participant minute;
- agent session minute;
- spoken AI audio minute;
- user audio minute;
- avatar video minute;
- meeting bot second;
- model text/audio tokens;
- recording and storage GB-month;
- egress GB;
- workflow activity;
- observability event/span;
- support and fixed platform costs.

## Channel formulas

### Native modular voice
`STT user_audio + LLM + TTS ai_audio + agent_session + WebRTC + infra + observability`

### Native S2S
`realtime audio/text tokens + agent_session + WebRTC + server controls + infra`

### Native video
`voice mode + avatar connected minute + video egress + warm pool amortization`

### External meeting
`native processing + meeting bot connected time + output media compute + recording/storage if enabled`

### Telephony
`voice mode + SIP/carrier legs + number + recording + transfer fees`

## Capacity

Track separately:
- concurrent realtime sessions;
- concurrent avatar sessions;
- meeting bots;
- model requests and audio streams;
- database connections;
- workflow throughput;
- egress.

## Budget enforcement

- pre-session estimate;
- hard maximum duration;
- soft threshold event;
- feature degradation before hard stop;
- tenant monthly cap;
- provider circuit if anomalous cost;
- cost reconciliation after session.

## Ledger evidence in M0

`cost_events` is the authoritative append-only monetary ledger. It records USD
attribution by tenant, optional session, provider, service, and unit. The
ledger uses fixed decimal scales: quantity has eight places, unit price ten,
and final USD amount eight. It computes `round(quantity * unit_cost_usd, 8)`
with half-up rounding for non-negative values.

`estimated`, `measured`, and `provider_reported` are separate evidence buckets.
A measured or provider-reported event may reference an estimated event for
provenance, but it never rewrites it. Aggregate reports retain source and unit
boundaries so a forecast is not silently added to actual cost and tokens are not
added to minutes.

Each new M0 event has a dated local rate-card reference, a server-minted local
provider request reference, and an internal trace ID. The opaque request
reference is bound to the rate card, tenant, and optional session, and may
produce one event per source, with same-event retries remaining idempotent. A
partial database uniqueness guard mirrors this replay boundary. The
generated numeric contract rejects values that cannot round-trip without losing
the scaled-decimal evidence. M0 does not ingest real invoices or call provider
billing APIs. Invoice reconciliation requires a later contract-first provider
integration.

## M1 fake session baseline

The frozen M1 Walking Skeleton attributes one nominal catalog lookup at USD
0.02 per fake session. Lifecycle, textual turns, replay, workflow and console
use local deterministic fakes with zero external attributed cost. The two
catalog invocations used only by the `unknown_tool_effect` failure injection
are excluded from the nominal baseline and recorded separately in
`artifacts/m1/evidence.json`. There is no measured or provider-reported cost.
This value proves the ledger and console path; it is not a production forecast.

## Spreadsheet

`spreadsheets/UNIT_ECONOMICS_V2.xlsx` contains editable provider catalog, scenarios, capacity, plans, sensitivity and actual-vs-model. Prices are dated inputs and must be refreshed before procurement.
