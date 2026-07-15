# Meeting room instructions
- This is a composition boundary only. It wires `RoomTransport` (M2-01) to a
  provider registry; it never imports a concrete SDK (LiveKit or otherwise).
- Business/session logic depends on `@axtro/meeting-gateway`'s `RoomTransport`
  interface, never on this app's internals.
- M2-07 (Scene and Presentation Director) renders through this boundary using
  allowlisted `scene_manifest`s only. No arbitrary URL or DOM automation.
