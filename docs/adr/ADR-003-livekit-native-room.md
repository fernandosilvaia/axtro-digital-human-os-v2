# ADR-003: LiveKit-compatible native room boundary

**Status:** Accepted with benchmark gate  
**Date:** 2026-07-14

## Context

The product needs a browser-native low-latency room where a programmatic agent can publish audio, video and data.

## Decision

Adopt a ChannelPort whose first real implementation is LiveKit-compatible. Business logic never imports the LiveKit SDK directly. External meeting providers remain separate adapters.

## Alternatives considered

Build raw WebRTC signaling and SFU; use a meeting bot as the only channel.

## Consequences

Fast path to a controlled room while preserving the ability to replace transport.

## Revisit trigger

LiveKit fails the M2 benchmark, regional needs or economics and another adapter passes the same contract tests.
