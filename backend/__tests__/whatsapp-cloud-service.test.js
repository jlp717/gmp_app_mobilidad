'use strict';

describe('whatsappCloudService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadService(env = {}) {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      WHATSAPP_CLOUD_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'token-test',
      WHATSAPP_PHONE_NUMBER_ID: '123456789',
      WHATSAPP_SEND_MODE: 'template',
      WHATSAPP_TEMPLATE_NAME: 'albaran_documento',
      WHATSAPP_TEMPLATE_LANG: 'es',
      ...env,
    };
    return require('../services/whatsappCloudService');
  }

  test('isConfigured requires enable flag and credentials', () => {
    const off = loadService({ WHATSAPP_CLOUD_ENABLED: 'false' });
    expect(off.isConfigured()).toBe(false);

    const on = loadService();
    expect(on.isConfigured()).toBe(true);
  });

  test('normalizeE164Digits prefixes Spanish mobile 9-digit numbers', () => {
    const svc = loadService();
    expect(svc.normalizeE164Digits('600000000')).toBe('34600000000');
    expect(svc.normalizeE164Digits('+34 600 000 000')).toBe('34600000000');
  });

  test('sendDocumentFromBot uploads media then sends template', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: 'media-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }),
      });
    global.fetch = fetchMock;

    const svc = loadService();
    const result = await svc.sendDocumentFromBot({
      telefono: '600000000',
      pdfBuffer: Buffer.from('%PDF-1.4'),
      filename: 'Albaran_A-1.pdf',
      caption: 'Albarán A-1',
      bodyParams: ['A-1', 'Cliente'],
    });

    expect(result).toEqual({
      success: true,
      messageId: 'wamid.TEST123',
      mode: 'TEMPLATE_DOCUMENT',
      to: '34600000000',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const messageCall = fetchMock.mock.calls[1];
    expect(String(messageCall[0])).toContain('/123456789/messages');
    const body = JSON.parse(messageCall[1].body);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('albaran_documento');
    expect(body.template.components[0].parameters[0].document.id).toBe('media-1');
  });
});
