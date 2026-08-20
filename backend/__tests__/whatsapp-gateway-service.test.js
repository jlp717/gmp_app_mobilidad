'use strict';

describe('whatsappGatewayService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.clearAllMocks();
  });

  function load({ baileysReady = false, baileysEnabled = false, cloudConfigured = false } = {}) {
    jest.resetModules();
    process.env = { ...originalEnv };

    jest.doMock('../services/whatsappBaileysService', () => ({
      isConfigured: jest.fn(() => baileysEnabled),
      isReady: jest.fn(() => baileysReady),
      ensureReady: jest.fn(async () => baileysReady),
      getStatus: jest.fn(() => ({
        provider: 'BAILEYS',
        enabled: baileysEnabled,
        ready: baileysReady,
      })),
      sendDocumentFromBot: jest.fn(async () => ({
        success: true,
        messageId: 'baileys-1',
        mode: 'BAILEYS_DOCUMENT',
        to: '34600000000',
      })),
    }));

    jest.doMock('../services/whatsappCloudService', () => ({
      isEnabled: jest.fn(() => cloudConfigured),
      isConfigured: jest.fn(() => cloudConfigured),
      sendDocumentFromBot: jest.fn(async () => ({
        success: true,
        messageId: 'cloud-1',
        mode: 'TEMPLATE_DOCUMENT',
        to: '34600000000',
      })),
    }));

    return require('../services/whatsappGatewayService');
  }

  test('prefers ready Baileys over Cloud', async () => {
    const gw = load({ baileysEnabled: true, baileysReady: true, cloudConfigured: true });
    const result = await gw.sendDocumentFromBot({
      telefono: '600000000',
      pdfBuffer: Buffer.from('%PDF'),
      filename: 'a.pdf',
      caption: 'x',
    });
    expect(result.provider).toBe('BAILEYS');
    expect(result.messageId).toBe('baileys-1');
  });

  test('uses Cloud when Baileys pending', async () => {
    const gw = load({ baileysEnabled: true, baileysReady: false, cloudConfigured: true });
    const result = await gw.sendDocumentFromBot({
      telefono: '600000000',
      pdfBuffer: Buffer.from('%PDF'),
      filename: 'a.pdf',
    });
    expect(result.provider).toBe('CLOUD');
  });

  test('throws NOT_PAIRED when only Baileys enabled but unpaired', async () => {
    const gw = load({ baileysEnabled: true, baileysReady: false, cloudConfigured: false });
    await expect(
      gw.sendDocumentFromBot({
        telefono: '600000000',
        pdfBuffer: Buffer.from('%PDF'),
        filename: 'a.pdf',
      }),
    ).rejects.toMatchObject({ code: 'WHATSAPP_BAILEYS_NOT_PAIRED' });
  });
});
