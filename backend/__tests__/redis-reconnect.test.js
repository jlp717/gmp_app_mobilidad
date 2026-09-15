'use strict';

const fs = require('fs');
const path = require('path');
const {
  redisReconnectDelay,
  REDIS_RECONNECT_WATCHDOG_MS,
} = require('../services/redis-cache');

describe('BE-08 Redis reconnect indefinitely', () => {
  test('reconnectStrategy never returns false (retries 0-20)', () => {
    for (let retries = 0; retries <= 20; retries += 1) {
      const delay = redisReconnectDelay(retries);
      expect(delay).not.toBe(false);
      expect(delay).toBe(Math.min(30000, 200 * (2 ** Math.min(retries, 7))));
    }
  });

  test('simulates 15 reconnect failures then ready success', async () => {
    jest.resetModules();
    const { EventEmitter } = require('events');
    const fakeClient = new EventEmitter();
    fakeClient.isOpen = false;
    fakeClient.connect = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    fakeClient.duplicate = jest.fn();

    jest.doMock('redis', () => ({
      createClient: () => fakeClient,
    }));

    const cacheMod = require('../services/redis-cache');
    await cacheMod.redisCache.init();
    expect(cacheMod.redisCache.isConnected).toBe(false);

    fakeClient.emit('connect');
    expect(cacheMod.redisCache.isConnected).toBe(false);

    for (let retries = 1; retries <= 15; retries += 1) {
      const delay = cacheMod.redisReconnectDelay(retries);
      expect(delay).not.toBe(false);
      expect(typeof delay).toBe('number');
      fakeClient.emit('error', Object.assign(new Error('ECONNREFUSED'), { message: 'ECONNREFUSED' }));
      expect(cacheMod.redisCache.isConnected).toBe(false);
    }

    fakeClient.emit('ready');
    expect(cacheMod.redisCache.isConnected).toBe(true);
  });

  test('watchdog is 30s with unref; isConnected only on ready', () => {
    const source = fs.readFileSync(path.join(__dirname, '../services/redis-cache.js'), 'utf8');
    expect(REDIS_RECONNECT_WATCHDOG_MS).toBe(30000);
    expect(source).toMatch(/setInterval/);
    expect(source).toMatch(/unref/);
    expect(source).toMatch(/!this\.isConnected/);
    expect(source).not.toMatch(/Max retries reached/);
    expect(source).toMatch(/this\.isConnected = true/);
    expect(source).toMatch(/on\('ready'/);
    expect(source).toMatch(/Math\.min\(30000, 200 \* \(2 \*\* Math\.min\(retries, 7\)\)\)/);
  });
});
