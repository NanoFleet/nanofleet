import { eq } from 'drizzle-orm';
import * as jose from 'jose';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode-terminal';
import { db } from '../db';
import { users } from '../db/schema';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Please set it in your .env file.`);
  return value;
}

const ACCESS_TOKEN_SECRET = new TextEncoder().encode(requireEnv('ACCESS_TOKEN_SECRET'));
const REFRESH_TOKEN_SECRET = new TextEncoder().encode(requireEnv('REFRESH_TOKEN_SECRET'));

export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY = '7d';

export async function generateAccessToken(userId: string, role: string): Promise<string> {
  return new jose.SignJWT({ userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(ACCESS_TOKEN_SECRET);
}

export async function generateRefreshToken(userId: string, role: string): Promise<string> {
  return new jose.SignJWT({ userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(REFRESH_TOKEN_SECRET);
}

export async function verifyAccessToken(token: string): Promise<jose.JWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, ACCESS_TOKEN_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<jose.JWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, REFRESH_TOKEN_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const max = 256 - (256 % chars.length); // largest multiple of chars.length <= 256
  const result: string[] = [];
  while (result.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      if (b < max) {
        result.push(chars[b % chars.length]);
        if (result.length === 16) break;
      }
    }
  }
  return result.join('');
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function verifyTotp(secret: string, token: string): boolean {
  return authenticator.verify({ token, secret });
}

export function generateQrCode(secret: string, userId: string): void {
  const otpauth = authenticator.keyuri(userId, 'NanoFleet', secret);
  qrcode.generate(otpauth, { small: true });
}

export async function checkBootstrapMode(): Promise<boolean> {
  const result = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  return result.length === 0;
}

export async function createAdminUser(
  username: string,
  passwordHash: string,
  totpSecret: string
): Promise<void> {
  const adminId = crypto.randomUUID();
  await db.insert(users).values({
    id: adminId,
    username,
    passwordHash,
    totpSecret,
    role: 'admin',
  });
}
