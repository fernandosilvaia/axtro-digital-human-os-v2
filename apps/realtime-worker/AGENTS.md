# Realtime worker instructions
- Never call Axtro Agent synchronously.
- Session Actor mutations are serialized; I/O is outside state locks.
- Propagate cancellation to model, TTS, avatar and channel.
- Every output carries generation_id and late output is discarded.
- Bounded queues and explicit timeouts are mandatory.
- Specialists never publish media.
