const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const AES_PREFIX = 'v2:';

function getRawKey(): Uint8Array {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('ENCRYPTION_KEY is not set. Please set it in your .env file.');
  }
  return new TextEncoder().encode(envKey.slice(0, 32).padEnd(32, '0'));
}

async function getCryptoKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', getRawKey(), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function checkEncryptionKey(): void {
  getRawKey();
}

export async function encrypt(text: string): Promise<string> {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  );
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return AES_PREFIX + Buffer.from(result).toString('base64');
}

// TODO: remove legacy XOR decrypt once all stored values have been re-saved with AES-GCM (v2: prefix)
function xorDecrypt(encrypted: string): string {
  const key = getRawKey();
  const data = Buffer.from(encrypted, 'base64');
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const dataByte = data[i];
    const keyByte = key[i % key.length];
    if (dataByte !== undefined && keyByte !== undefined) {
      result[i] = dataByte ^ keyByte;
    }
  }
  return new TextDecoder().decode(result);
}

export async function decrypt(encrypted: string): Promise<string> {
  if (!encrypted.startsWith(AES_PREFIX)) {
    return xorDecrypt(encrypted);
  }
  const key = await getCryptoKey();
  const data = Buffer.from(encrypted.slice(AES_PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
