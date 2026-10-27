import { asyncHandler, unauthorized } from '../lib/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function displayName(req) {
  const raw = req.get('x-chula-user-name');
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim().slice(0, 80) || null;
  } catch {
    return null;
  }
}

/**
 * With Supabase configured, requests must carry the user's Supabase access
 * token (Authorization: Bearer <jwt>). In the in-memory demo store there is
 * no auth server, so the browser sends a stable per-device id instead.
 */
export function createRequireUser({ store }) {
  return asyncHandler(async (req, _res, next) => {
    if (store.kind === 'supabase') {
      const header = req.get('authorization') || '';
      const accessToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!accessToken) throw unauthorized();
      const user = await store.verifyAccessToken(accessToken);
      if (!user) throw unauthorized('Your session has expired. Please sign in again.');
      req.user = { id: user.id, email: user.email, fullName: displayName(req) };
      return next();
    }

    const demoId = req.get('x-chula-demo-user') || '';
    if (!UUID_RE.test(demoId)) throw unauthorized('Missing demo session id');
    req.user = { id: demoId, email: null, fullName: displayName(req) || 'Chula guest' };
    return next();
  });
}
