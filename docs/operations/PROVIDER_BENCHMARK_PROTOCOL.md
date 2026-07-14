# Provider Benchmark Protocol

## Test corpus

- 30 PT-BR conversational clips;
- 10 English and 10 Spanish clips;
- names, brands, currency, dates and emails;
- quiet, office noise, crosstalk and mobile network;
- 10, 30 and 60 minute sessions;
- interruption and reconnect scenarios.

## Scores

### Voice
Latency, word accuracy, exact entity capture, prosody, stability, interruption, pronunciation and cost.

### Avatar
First frame, lip sync, listening realism, gesture repetition, interruption, long-session drift, resolution, resource usage and cost.

### Meeting bot
Join success, waiting time, removal handling, output latency, camera/screenshare behavior, platform variance and reconnect.

## Method

- same prompts and audio fixtures;
- randomized blind human review where possible;
- at least 30 sessions per candidate for key metrics;
- store provider and model version;
- no cherry-picked best run;
- confidence interval for major measures;
- record all failures.

## Decision record

Provider selection ADR must include raw summary, weighted score, cost, legal constraints, fallback and exit trigger.
