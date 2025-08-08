import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const { JWT_ISSUER, JWT_AUDIENCE, ALLOW_INSECURE_DEV } = process.env;

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).send('Missing Bearer token');
  const token = m[1];

  // NOTE: For a production system, validate the JWT signature using the B2C JWKS.
  // Here we only decode & basic-validate to keep the starter simple.
  try {
    const decoded = jwt.decode(token, { complete: true }) || {};
    const claims = decoded.payload || {};
    if (!claims.iss || !claims.aud) throw new Error('Invalid token');
    if (JWT_ISSUER && !claims.iss.startsWith(JWT_ISSUER)) throw new Error('Issuer mismatch');
    if (JWT_AUDIENCE && claims.aud !== JWT_AUDIENCE) throw new Error('Audience mismatch');
    req.user = claims;
    next();
  } catch (e) {
    if (ALLOW_INSECURE_DEV === 'true') {
      // Dev mode: accept token but attach note
      req.user = { sub:'dev-user', roles:['admin'], note:'INSECURE_DEV' };
      return next();
    }
    return res.status(401).send('Invalid token');
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    const roles = req.user?.roles || req.user?.scp?.split(' ') || [];
    if (roles.includes(role) || roles.includes('admin')) return next();
    return res.status(403).send('Forbidden');
  };
}
