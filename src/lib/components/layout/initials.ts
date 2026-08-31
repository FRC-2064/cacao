/**
 * The one or two letters that stand in for a photograph.
 *
 * Avatars went with the rest of the personal data: there is no image column,
 * no upload, and no Google photo to fall back to. Every place that used to
 * show a face shows this instead.
 *
 * Built from `displayName` and nothing else, because `displayName` is the only
 * name-shaped value on the wire -- "Ada L" becomes "AL", and the placeholders
 * the server hands back for people who have never asked for edit access
 * ("Unnamed member", "Unknown member") become "UM". Never rebuild a person's
 * name from parts to get at this; the parts are frequently absent.
 */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}
