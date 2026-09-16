import { auth } from '../config/firebase';

// Attaches the signed-in user's Firebase ID token so Cloud Functions can
// verify who's calling and scope data to that user.
export async function authedFetch(url, options = {}) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
