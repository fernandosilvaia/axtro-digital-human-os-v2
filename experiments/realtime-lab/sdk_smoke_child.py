"""Private -I child entry. Only the parent sanitized subprocess invokes it."""
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import sdk_smoke_local

if __name__ == "__main__":
    try:
        print(json.dumps(asyncio.run(sdk_smoke_local()), allow_nan=False))
    except Exception:
        raise SystemExit(1)
