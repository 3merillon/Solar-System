# Experiment 001: bounds on detail that was never evaluated

Purpose: test a necessary primitive before building an attractive renderer around an unverified assumption.

## Analytic spectral diagnostic

The reference uses a deliberately simple periodic function:

    h(u,v) = sum(k >= 0) A * r^k * sin(tau * 2^k * u + phase_k)
                                  * sin(tau * 2^k * v + phase_k/2)

Each term has absolute height at most A*r^k. After evaluating n bands:

    abs(h - h_n) <= E_n = A * r^n / (1-r), for 0 <= r < 1.

No finer samples or spatial tree are needed to compute that envelope. Evaluating the prefix still costs O(n). This is not constant-time terrain generation.

Each band doubles frequency. A conservative gradient magnitude tail is summable only when 2*r < 1. Thus a field can have a tiny remaining height error while lacking a finite gradient-tail bound. Height convergence alone cannot certify normal/shading convergence.

The CPU tests compare prefixes against 64 evaluated bands over deterministic addresses and several roughness ratios. They are numerical regression tests around an analytic real-arithmetic derivation, not formal floating-point interval proofs. Infinite-tail error beyond the reference must remain conceptually distinct from agreement with that finite reference.

Q0.64 integer phase extraction tests address identity through deep binary scales. It deliberately postpones f32 conversion until after integer shifts. It is not an implementation of a seamless spherical atlas or universe coordinate system.

## Arbitrary-topology diagnostic

`implicit::BoredSphere` is a sphere with a cylindrical tunnel subtracted. It is a solid field with more than one crossing along some radial rays, not a radial heightmap. Its scalar value need not be exact signed distance.

Both primitive fields are 1-Lipschitz and max(f, -g) remains 1-Lipschitz. For a region enclosed in a ball of radius rho, a field value f(c) yields the real-arithmetic interval [f(c)-rho, f(c)+rho]. Tests check sampled points and classify known solid, empty and boundary regions. Production intervals need floating-point rounding/error treatment.

This demonstrates a bounds interface. It does not extract a mesh, certify its topology, or accelerate a realistic planet.

## Lazy deterministic clearance experiment

Take an evaluated scalar prefix g, a globally valid omitted-field bound |r| <= E, and a Lipschitz bound L for g. If g(p) > E, then every point within

    clearance = (g(p)-E)/L

is outside the complete solid g+r, in real arithmetic. The omitted field's derivative does not appear in this particular exclusion argument. This is the useful mechanism to investigate: expensive rough residuals need not be evaluated to skip proven empty space.

`tracing` applies this to the tunnel solid plus 16 finite trigonometric deformation bands. It compares lazy evaluation to full-spectrum/global-bound stepping over 2,145 deterministic rays. The full baseline evaluates every band at each step. Both expose iteration exhaustion and do not force a minimum step.

**Termination caveat:** the experiment returns a field-residual candidate, not a certified first ray intersection. A small field residual does not bound along-ray root error, particularly at grazing angles. The next experiment must isolate the first intersection in an interval and handle tangencies. Similar candidate counts do not prove equal images or equal first roots.

## GPU probe

The separate WGSL spectral kernel processes 4,096 sample addresses at several prefix lengths, then checks CPU-reference disagreement and the omitted-height envelope. The numerical allowance is 0.05 m for the tested 8,000 m amplitude. The observed 0.0138 m maximum native disagreement fails a hypothetical millimetre target. That finding is intentional evidence for redesigning accumulation and local evaluation.

The GPU probe currently tests the spectral primitive, not the ray-marching loop or unified fields. Submission/readback wall time is not shader-only time or frame time. Native and browser results must be recorded separately.
