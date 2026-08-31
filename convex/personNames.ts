/**
 * What a member's own first name is allowed to be -- the single
 * implementation, on the server.
 *
 * The same shape as `convex/donorNames.ts` and for the same reason: the rule
 * has to run in two places. `convex/users.ts` enforces it, throwing the
 * message this file returns, because the client is not trusted to have done
 * it; `UserProfileModal.svelte` reads it to say so *before* the form is
 * submitted, because the alternative is a viewer watching an optimistic name
 * apply and then a red toast contradict it a moment later. Two copies of a
 * validation rule that drift do not produce an error -- they produce a form
 * that promises one thing and a server that does another.
 *
 * A leaf with no imports, deliberately, so it can be reached from a Convex
 * function and from the browser bundle alike. The direction matters and is not
 * arbitrary: the client imports the server's copy, never the reverse. See the
 * header of `convex/donorNames.ts`, which explains that at length.
 */

/**
 * The longest a first name may be. Generous enough that no real one is
 * refused -- the point of the cap is that the field is bounded at all, not
 * that it is tight.
 */
export const FIRST_NAME_MAX = 40;

/**
 * Why this first name cannot be stored, or `null` if it can.
 *
 * `lastInitial` is truncated to one character server-side because "there is no
 * column a surname fits in" is a property the schema enforces. `firstName` had
 * no cap and no shape check, so the other half of the same promise -- the
 * request form's own "No surname, no email address, no photo", and
 * `convex/auth.ts`'s "a first name and last initial only enter once someone
 * asks for edit access" -- was undefended for the half a person actually
 * types. `a.student@example.org` stored verbatim and rendered to every
 * signed-in member through `listUsers`, the request card, and `requesterName`
 * / `purchaserName` / `assigneeName` on every expense and grant.
 *
 * Refused rather than silently truncated or redacted: a shortened name is one
 * the person cannot see went wrong, and these strings are written to be read
 * by whoever typed it.
 *
 * The `@` test is containment rather than
 * `donorNames.isEmailShapedDonorName`'s full address shape, and deliberately
 * stricter than it. That helper exists for a donor *name* box, where "John
 * Smith (john@example.com)" has to be recognised inside a real name; a first
 * name never contains an `@` at all, and "levi@school" -- no TLD, so no match
 * for the address regex -- is still a school account fragment. There is
 * nothing on the other side of the trade here.
 *
 * A blank is allowed, and means what it says: a member taking their own name
 * back off the roster, which on a branch about storing less has to stay
 * possible. Requiring a name is `users.requestEditAccess`'s job, because
 * identifying yourself is what that mutation is *for*. This function is about
 * shape.
 */
export function firstNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length > FIRST_NAME_MAX) {
    return `A first name has to be ${FIRST_NAME_MAX} characters or fewer.`;
  }
  if (name.includes("@")) {
    return "A first name cannot contain an email address -- this app never stores one.";
  }
  if (/\s/.test(name)) {
    return "First name only, please -- no surname. The last initial goes in the next box.";
  }
  return null;
}
