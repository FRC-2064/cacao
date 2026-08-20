import { redirect } from '@sveltejs/kit';

/** The app has no distinct home screen; grants is the working default. */
export const load = () => {
  redirect(307, '/grants');
};
