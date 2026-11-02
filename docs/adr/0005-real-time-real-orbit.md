# 0005: Real-time Sun, real orbital motion

Status: accepted, 2026-11-02. This supersedes the earlier 60× time-lapse decision.

## Context

The site's physics credibility rests on the scene being real right now. Real time felt too slow in the prototype, so we tried a 60× time-lapse. But at 60×, the lighting drifts away from the real present within seconds, which makes the "lit by where the Sun is right now" claim false.

## Decision

- **Real-time clock:** keep the clock at real time. Compute Sun direction and body orientation with `astronomy-engine`, which uses the IAU 2015 rotation models.
- **Real orbit:** get the motion from the camera instead. It rides a real low orbit at real orbital speed: a circular two-body orbit using the body's GM. At Mars, 380 km up, that's about 3.4 km/s with a period of about two hours.
- **Orbit choice:** each load picks one of three orbits:
  - A dawn-dusk orbit that rides the terminator.
  - An orbital sunrise, starting about a minute before the Sun clears the limb.
  - A feature flyover over a feature that currently has a low Sun.
- **Starting point:** choosing the orbit and the camera's starting point is a camera choice. The clock is never shifted.
- **Telemetry:** shows altitude and orbital speed in place of a time rate.
- **Reduced motion:** visitors with reduced motion turned on get a still camera.

## Consequences

- **Honest copy:** the copy can truthfully say the lighting is where the Sun is right now, and that the viewer is in a real orbit.
- **Light shafts:** the orbital sunrise shot needs volumetric shadowing in the atmosphere, which is added to Phase 2.
- **Night side:** Mars has no city lights, so night side views are a dark disc with a glowing rim. Orbital sunrise only starts there for about a minute.
- **Gas giants:** cloud band drift is slow at real time, so the orbit carries the visible motion.
