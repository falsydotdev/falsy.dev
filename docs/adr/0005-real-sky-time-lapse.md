# 0005: Real sky, 60× time-lapse

Status: accepted, 2026-11-02

## Context

The site's physics credibility rests on the scene being real right now. Real time felt too slow in the prototype.

## Decision

- Compute Sun direction and body orientation with `astronomy-engine`, which uses the IAU 2015 rotation models.
- The simulation clock starts at the real present and runs at 60×. Reduced-motion visitors get 1×.
- Feature shots pick only features that currently have a low Sun. We never jump the clock forward.
- The telemetry shows the rate, any relief exaggeration, and live coordinates.

## Consequences

- At 60×, a Mars day takes about 25 minutes, so the planet visibly turns beneath terminator shots.
- Feature availability depends on the time of day, so each body needs about 10 listed features to keep feature shots common.
