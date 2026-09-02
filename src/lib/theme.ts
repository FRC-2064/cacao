import { createTheme } from '@frc2064/ui/theme';

/**
 * Cacao's theme store.
 *
 * The key is `cacao_theme_v1` and must stay that way: it is what is already in
 * every member's localStorage, and changing it silently resets everyone to
 * system. The matching literal is inlined in `src/app.html`, which is static
 * and cannot call `prepaint()` -- if you change one, change both.
 */
export const theme = createTheme({ key: 'cacao_theme_v1' });
