import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM 加密/解密服务
 * 用于加密存储交易所 API Key/Secret
 *
 * 格式: base64(iv) : base64(authTag) : base64(ciphertext)
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('encryptionKey') || '';
    if (encryptionKey.length !== 32) {
      this.logger.warn(
        `ENCRYPTION_KEY 长度应为 32 字节(当前 ${encryptionKey.length}),建议在 .env 中设置正确长度的密钥`,
      );
    }
    // 确保密钥固定 32 字节(不足补0,超长截断)
    this.key = crypto.createHash('sha256').update(encryptionKey).digest();
  }

  /**
   * 加密明文
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext}`;
  }

  /**
   * 解密密文
   */
  decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format, expected iv:authTag:ciphertext');
    }
    const [ivB64, authTagB64, ciphertextB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(ciphertext, undefined, 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  }

  /**
   * 批量加密对象字段
   */
  encryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj };
    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        result[field] = this.encrypt(result[field] as string) as any;
      }
    }
    return result;
  }

  /**
   * 批量解密对象字段
   */
  decryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj };
    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        try {
          result[field] = this.decrypt(result[field] as string) as any;
        } catch (e) {
          this.logger.error(`Failed to decrypt field ${String(field)}: ${(e as Error).message}`);
        }
      }
    }
    return result;
  }
}
