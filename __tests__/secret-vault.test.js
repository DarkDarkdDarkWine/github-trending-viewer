describe('secret-vault', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });

  test('encrypts and decrypts a plaintext secret', () => {
    const vault = require('../src/crypto/secret-vault');
    const encrypted = vault.encrypt('sk-test-secret');

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('sk-test-secret');
    expect(vault.decrypt(encrypted)).toBe('sk-test-secret');
  });

  test('returns plaintext legacy values unchanged', () => {
    const vault = require('../src/crypto/secret-vault');
    expect(vault.decrypt('legacy-key')).toBe('legacy-key');
    expect(vault.decrypt('')).toBe('');
    expect(vault.encrypt('')).toBe('');
  });

  test('requires a 32-byte base64 encryption key', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    const vault = require('../src/crypto/secret-vault');

    expect(() => vault.encrypt('secret')).toThrow('ENCRYPTION_KEY must be 32 bytes');
  });

  test('rejects tampered ciphertext', () => {
    const vault = require('../src/crypto/secret-vault');
    const encrypted = vault.encrypt('secret');
    const tampered = encrypted.slice(0, -2) + 'aa';

    expect(() => vault.decrypt(tampered)).toThrow();
  });
});
