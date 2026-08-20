/**
 * The JavaScript half of the motion system.
 *
 * `src/styles/app.css` owns the same tokens for anything CSS can animate on
 * its own. Svelte transitions cannot read a CSS custom property, so the curves
 * are restated here — and they must stay in step with the `--ease-*` and
 * `--dur-*` tokens in that file, or a drawer will move on a different curve
 * from the button that opened it.
 *
 * Values are Material 3 Expressive, taken from caelestia-dots/shell
 * (`plugin/src/Caelestia/Config/tokens.hpp`). See the motion block in app.css
 * for what separates the two families and when to reach for each.
 */

/** Durations in milliseconds, matching the `--dur-*` tokens. */
export const dur = {
  fastEffects: 150,
  defaultEffects: 200,
  slowEffects: 300,
  fastSpatial: 350,
  defaultSpatial: 500,
  slowSpatial: 650
} as const;

/**
 * Builds a Svelte easing function from cubic bezier control points, the same
 * four numbers CSS `cubic-bezier()` takes.
 *
 * The curve is parametric: both x (time) and y (progress) are functions of an
 * internal parameter t, and Svelte hands us x and wants y. So each call has to
 * invert x(t) first. Newton-Raphson converges in a couple of iterations for
 * well-behaved curves; the bisection fallback catches the flat spots where the
 * derivative is near zero and Newton would shoot off.
 *
 * Note that y is deliberately *not* clamped to [0, 1] — the spatial curves
 * have a control point at y = 1.67 and must be allowed to overshoot and swing
 * back. Clamping them would quietly turn the whole system back into ease-out.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const slope = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  };

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = curve(x1, x2, t) - x;
      if (Math.abs(err) < 1e-6) return curve(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }

    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const err = curve(x1, x2, t);
      if (Math.abs(err - x) < 1e-6) break;
      if (err < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
      if (hi - lo < 1e-7) break;
    }
    return curve(y1, y2, t);
  };
}

/** Resolve in place — colour, opacity, tint. These never overshoot. */
export const fastEffects = cubicBezier(0.31, 0.94, 0.34, 1);
export const defaultEffects = cubicBezier(0.34, 0.8, 0.34, 1);
export const slowEffects = cubicBezier(0.34, 0.88, 0.34, 1);

/** Move, grow, or change shape. These overshoot slightly and settle back. */
export const fastSpatial = cubicBezier(0.42, 1.67, 0.21, 0.9);
export const defaultSpatial = cubicBezier(0.38, 1.21, 0.22, 1);
export const slowSpatial = cubicBezier(0.39, 1.29, 0.35, 0.98);

/** Entering a scene: fast off the mark, long settle. No overshoot. */
export const emphasizedDecel = cubicBezier(0.05, 0.7, 0.1, 1);
/** Leaving a scene: slow to commit, then gone. */
export const emphasizedAccel = cubicBezier(0.3, 0, 0.8, 0.15);
export const standard = cubicBezier(0.2, 0, 0, 1);

/**
 * Presets for list motion.
 *
 * Ten keyed lists across the app share these so that filtering the grants
 * board and filtering the sponsor grid do not end up moving at visibly
 * different speeds. Spread them into the directives:
 *
 *     animate:flip={listItem.flip}
 *     in:fly={listItem.in}
 *     out:scale={listItem.out}
 *
 * Reordering is always the slowest of the three. It is the change the user
 * needs to actually track with their eyes — an item leaving is not.
 */

/** Cards in a grid or column, where scaling and sliding both look right. */
export const listItem = {
  flip: { duration: dur.defaultSpatial, easing: defaultSpatial },
  in: { y: 12, duration: dur.fastSpatial, easing: emphasizedDecel },
  out: { start: 0.96, opacity: 0, duration: dur.fastEffects, easing: emphasizedAccel }
} as const;

/**
 * Table rows. These fade rather than fly: a `<tr>` cannot be transformed
 * independently of its cells in every engine, and a row that slides sideways
 * out of its own column grid looks broken even where it does work. `flip` is
 * kept because vertical reordering is exactly what sorting needs to show.
 */
export const listRow = {
  flip: { duration: dur.defaultSpatial, easing: defaultSpatial },
  in: { duration: dur.defaultEffects, easing: emphasizedDecel },
  out: { duration: dur.fastEffects, easing: emphasizedAccel }
} as const;
