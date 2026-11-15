import jwt from 'jsonwebtoken';

function readBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function requireMaster(req, res, next) {
  const token = readBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'master') {
      return res.status(403).json({ error: 'Master access required' });
    }
    req.master = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function signMasterToken(owner) {
  return jwt.sign(
    { sub: owner.id, email: owner.email, name: owner.name, role: 'master' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function requireOwner(req, res, next) {
  const token = readBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'owner') {
      return res.status(403).json({ error: 'Restaurant owner access required' });
    }
    req.owner = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function signOwnerToken(owner) {
  return jwt.sign(
    {
      sub: owner.id,
      email: owner.email,
      name: owner.name,
      restaurantId: owner.restaurantId || null,
      role: 'owner',
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/** Owner or master JWT required (for publish / privileged writes). */
export function requireOwnerOrMaster(req, res, next) {
  const token = readBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role === 'master') {
      req.master = payload;
      return next();
    }
    if (payload.role === 'owner') {
      req.owner = payload;
      return next();
    }
    return res.status(403).json({ error: 'Owner or master access required' });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
