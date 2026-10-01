'use strict';

const {
  evaluatePhotoWindow,
  photoEvidenceDeadline,
} = require('../services/evidence-photo-window');
const { createDeliveryEvidenceService, KINDS } = require('../services/delivery-evidence-service');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
  'base64',
);

function weekdayMadrid(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
  }).format(new Date(iso));
}

describe('photo evidence window Europe/Madrid', () => {
  const deliveryThursday = '2026-10-01T08:00:00.000Z';

  test('allows just before the deadline, the exact second, and rejects one second later', () => {
    expect(weekdayMadrid(deliveryThursday)).toBe('Thursday');
    const deadline = photoEvidenceDeadline(deliveryThursday);
    expect(deadline.toISOString()).toBe('2026-10-08T21:59:59.000Z');
    expect(weekdayMadrid(deadline.toISOString())).toBe('Thursday');

    expect(evaluatePhotoWindow({
      deliveryAt: deliveryThursday,
      now: '2026-10-08T21:59:58.000Z',
    }).ok).toBe(true);
    expect(evaluatePhotoWindow({
      deliveryAt: deliveryThursday,
      now: '2026-10-08T21:59:59.000Z',
    }).ok).toBe(true);
    const after = evaluatePhotoWindow({
      deliveryAt: deliveryThursday,
      now: '2026-10-08T22:00:00.000Z',
    });
    expect(after).toMatchObject({
      ok: false,
      code: 'EVIDENCE_WINDOW_CLOSED',
      deadline: '2026-10-08T21:59:59.000Z',
    });
  });

  test('spring DST deadline is 23:59:59 CEST (UTC+2), not delivery plus 168 hours', () => {
    const delivery = '2026-03-22T22:59:00.000Z';
    expect(weekdayMadrid(delivery)).toBe('Sunday');
    const deadline = photoEvidenceDeadline(delivery);
    expect(deadline.toISOString()).toBe('2026-03-29T21:59:59.000Z');
    expect(weekdayMadrid(deadline.toISOString())).toBe('Sunday');
    expect(evaluatePhotoWindow({ deliveryAt: delivery, now: deadline }).ok).toBe(true);
    expect(evaluatePhotoWindow({
      deliveryAt: delivery,
      now: '2026-03-29T22:00:00.000Z',
    }).ok).toBe(false);
  });

  test('fall DST deadline is 23:59:59 CET (UTC+1) after the clock goes back', () => {
    const delivery = '2026-10-18T21:59:00.000Z';
    expect(weekdayMadrid(delivery)).toBe('Sunday');
    const deadline = photoEvidenceDeadline(delivery);
    expect(deadline.toISOString()).toBe('2026-10-25T22:59:59.000Z');
    expect(weekdayMadrid(deadline.toISOString())).toBe('Sunday');
    expect(evaluatePhotoWindow({ deliveryAt: delivery, now: deadline }).ok).toBe(true);
    expect(evaluatePhotoWindow({
      deliveryAt: delivery,
      now: '2026-10-25T23:00:00.000Z',
    }).ok).toBe(false);
  });

  test('a Sunday 23:59 delivery stays open through the next Sunday 23:59:59', () => {
    const delivery = '2026-10-04T21:59:00.000Z';
    expect(weekdayMadrid(delivery)).toBe('Sunday');
    const deadline = photoEvidenceDeadline(delivery);
    expect(deadline.toISOString()).toBe('2026-10-11T21:59:59.000Z');
    expect(evaluatePhotoWindow({ deliveryAt: delivery, now: delivery }).ok).toBe(true);
    expect(evaluatePhotoWindow({ deliveryAt: delivery, now: deadline }).ok).toBe(true);
    expect(evaluatePhotoWindow({
      deliveryAt: delivery,
      now: '2026-10-11T22:00:00.000Z',
    }).code).toBe('EVIDENCE_WINDOW_CLOSED');
  });
});

test('a direct photo upload outside the window fails before persistence', async () => {
  const stage = jest.fn();
  const service = createDeliveryEvidenceService({
    repository: { stage, getLinked: jest.fn() },
    clock: () => new Date('2026-10-08T22:00:00.000Z'),
  });

  await expect(service.stagePhoto({
    documentId: '2026-S-10-404-4300009479',
    repartidorId: '98',
    mimeType: 'image/png',
    buffer: PNG,
    deliveryAt: '2026-10-01T08:00:00.000Z',
  })).rejects.toMatchObject({
    code: 'EVIDENCE_WINDOW_CLOSED',
    statusCode: 422,
  });
  expect(stage).not.toHaveBeenCalled();
  expect(KINDS.PHOTO).toBe('FOTO');
});
