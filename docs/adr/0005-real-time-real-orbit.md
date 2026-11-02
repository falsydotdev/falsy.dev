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

## Implementation notes (2026-11-03)

The math lives in `src/scene/` (`orbit.ts`, `shots.ts`, `ephemeris.ts`), tested in `tests/scene/`.

- **Frames:** the orbit propagates in J2000 equatorial coordinates. Each sample converts to body-fixed coordinates with the IAU 2015 Mars frame, so the planet turns under the camera, about 29° of longitude per orbit.
- **Constants:** GM is 42,828.37 km³/s² (JPL DE440). The radius is the 3,396.19 km MOLA reference sphere. At 380 km that gives 3.37 km/s and a period of 1.96 h.
- **Dawn-dusk orbit:** the plane is perpendicular to the Sun line at load time. It isn't a J2 sun-synchronous orbit, so the readout says "dawn-dusk", never "sun-synchronous".
- **Orbital sunrise:** the Sun line lies in the orbit plane. With a cylindrical shadow, the camera leaves the shadow at θ = π + asin(R / a). The shot starts 60 s before that.
- **Feature flyover:** the plane contains the feature (at pass time, accounting for rotation) and the local along-terminator direction. The pass happens 180 s after load. Features qualify when the Sun is 5° to 25° above their horizon. If none qualify, the shot falls back to dawn-dusk.
- **Weights:** dawn-dusk 0.4, orbital sunrise 0.3, and feature flyover 0.3.

## Consequences

- **Honest copy:** the copy can truthfully say the lighting is where the Sun is right now, and that the viewer is in a real orbit.
- **Light shafts:** the orbital sunrise shot needs volumetric shadowing in the atmosphere, which is added to Phase 2.
- **Night side:** Mars has no city lights, so night side views are a dark disc with a glowing rim. Orbital sunrise only starts there for about a minute.
- **Gas giants:** cloud band drift is slow at real time, so the orbit carries the visible motion.
