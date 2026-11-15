import crypto from 'node:crypto';
import type express from 'express';
import type { OrganizerSession } from '../shared/api';
import { isProduction } from './env';

// Organizer access codes come from ORGANIZER_ACCESS_CODES, formatted as
//   Organization Name=code;Another Organization=another-code
// Each organization signs in with its own code and can only edit its own events.

type Organization = { id: string; name: string; code: string };

const COOKIE = 'ts_organizer';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const DEV_CODES = 'Demo Org A=demo-a;Demo Org B=demo-b';

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
}

function loadOrganizations(): Organization[] {
  const raw = process.env.ORGANIZER_ACCESS_CODES ?? (isProduction ? '' : DEV_CODES);
  return raw.split(';').map(entry => entry.trim()).filter(Boolean).flatMap(entry => {
    const eq = entry.lastIndexOf('=');
    if (eq <= 0) return [];
    const name = entry.slice(0, eq).trim();
    const code = entry.slice(eq + 1).trim();
    return name && code ? [{ id: slug(name), name, code }] : [];
  });
}

const organizations = loadOrganizations();
if (!organizations.length) console.warn('No organizer access codes configured; organizer sign-in is disabled.');

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (isProduction) throw new Error('SESSION_SECRET is required in production.');
  return 'development-only-session-secret';
}
const secret = sessionSecret();

function sign(value: string) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function findOrganizationByCode(code: string): Organization | null {
  return organizations.find(org => safeEqual(org.code, code)) ?? null;
}

export function setSessionCookie(res: express.Response, org: Organization) {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${org.id}.${expires}`;
  const value = `${payload}.${sign(payload)}`;
  res.cookie(COOKIE, value, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: MAX_AGE_SECONDS * 1000, path: '/' });
}

export function clearSessionCookie(res: express.Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function getSession(req: express.Request): OrganizerSession | null {
  const value = readCookie(req, COOKIE);
  if (!value) return null;
  const [orgId, expires, signature] = value.split('.');
  if (!orgId || !expires || !signature) return null;
  if (!safeEqual(signature, sign(`${orgId}.${expires}`))) return null;
  if (Number(expires) < Date.now() / 1000) return null;
  const org = organizations.find(o => o.id === orgId);
  return org ? { organizationId: org.id, organizationName: org.name } : null;
}

export function requireOrganizer(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Sign in with your organization access code.' });
  res.locals.organizer = session;
  next();
}
