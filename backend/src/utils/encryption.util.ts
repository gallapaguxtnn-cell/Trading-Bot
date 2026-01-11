import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const IV_LENGTH = 16;
// Ensure you set ENCRYPTION_KEY in .env (must be 32 chars for aes-256)
// For demo/dev, we can fallback or throw error.
const PASSWORD = process.env.ENCRYPTION_KEY || 'default-insecure-password-change-me';

export class EncryptionUtil {
  static async encrypt(text: string): Promise<string> {
    if (!text) return text;
    const iv = randomBytes(IV_LENGTH);
    const key = (await promisify(scrypt)(PASSWORD, 'salt', 32)) as Buffer;
    const cipher = createCipheriv('aes-256-ctr', key, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  static async decrypt(text: string): Promise<string> {
    if (!text) return text;
    const [ivPart, encryptedPart] = text.split(':');
    if (!ivPart || !encryptedPart) return text; 
    
    const iv = Buffer.from(ivPart, 'hex');
    const encryptedText = Buffer.from(encryptedPart, 'hex');
    
    const key = (await promisify(scrypt)(PASSWORD, 'salt', 32)) as Buffer;
    const decipher = createDecipheriv('aes-256-ctr', key, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString();
  }
}
