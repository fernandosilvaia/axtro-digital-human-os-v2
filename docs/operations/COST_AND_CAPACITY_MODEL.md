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

## Spreadsheet

`spreadsheets/UNIT_ECONOMICS_V2.xlsx` contains editable provider catalog, scenarios, capacity, plans, sensitivity and actual-vs-model. Prices are dated inputs and must be refreshed before procurement.
