describe("PerformanceCache Redis adapter hardening", () => {
  afterEach(() => {
    delete global.redisCache;
    jest.resetModules();
  });

  test("uses available get and setex methods without direct flushdb dependency", async () => {
    const get = jest.fn().mockResolvedValue(null);
    const setex = jest.fn().mockResolvedValue("OK");
    global.redisCache = { get, setex };

    const { performanceCache } = require("../src/core/infrastructure/cache/performance-cache");
    const result = await performanceCache.get("cache-key", async () => ({ ok: true }), { l1: 1, l2: 10 });

    expect(result).toEqual({ data: { ok: true }, source: "FETCH", cached: false });
    expect(get).toHaveBeenCalledWith("cache-key");
    expect(setex).toHaveBeenCalledWith("cache-key", 10, JSON.stringify({ ok: true }));
  });

  test("coalesces concurrent misses for the same key", async () => {
    const { performanceCache } = require("../src/core/infrastructure/cache/performance-cache");
    const fetcher = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: "single-flight" };
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => performanceCache.get("same-key", fetcher, { l1: 1, l2: 10 })),
    );

    expect(results).toEqual(
      Array.from({ length: 5 }, (_, index) => ({
        data: { ok: "single-flight" },
        source: index === 0 ? "FETCH" : "COALESCED",
        cached: index !== 0,
      })),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(performanceCache.getStats().coalesced).toBe(4);
  });

  test("invalidateAll clears L1 and never calls flushdb on global redis cache", () => {
    const del = jest.fn().mockResolvedValue(1);
    const flushdb = jest.fn().mockResolvedValue("OK");
    global.redisCache = { del, flushdb };

    const { performanceCache } = require("../src/core/infrastructure/cache/performance-cache");
    performanceCache.setL1("COMERCIAL:products", { ok: true }, 60);
    performanceCache.invalidateAll();

    expect(performanceCache.getL1("COMERCIAL:products")).toBeNull();
    expect(flushdb).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith("ALL:*");
    expect(del).toHaveBeenCalledWith("COMERCIAL:*");
  });
  test("preWarmAllQueries limits concurrent fetches", async () => {
    const { performanceCache } = require("../src/core/infrastructure/cache/performance-cache");
    let active = 0;
    let maxActive = 0;
    const fetchFns = {};
    for (let i = 0; i < 12; i += 1) {
      fetchFns["q" + i] = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: i };
      };
    }

    await performanceCache.preWarmAllQueries(fetchFns, { batchSize: 3 });

    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
