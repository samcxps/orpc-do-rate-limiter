/** biome-ignore-all lint/suspicious/useAwait: ignore for testing */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiterDurableObject } from "./durable-object";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

type DurableObjectStorage = {
  get: <T>(key: string) => Promise<T | undefined>;
  put: (key: string, value: unknown) => Promise<void>;
  delete: (keys: string[]) => Promise<void>;
  list: <T>() => Promise<Map<string, T>>;
  getAlarm: () => Promise<number | null>;
  setAlarm: (scheduledTime: number) => Promise<void>;
  deleteAlarm: () => Promise<void>;
};

type DurableObjectState = {
  storage: DurableObjectStorage;
  blockConcurrencyWhile: (fn: () => Promise<void>) => Promise<void>;
};

describe("RateLimiterDurableObject", () => {
  let mockStorage: DurableObjectStorage;
  let mockCtx: DurableObjectState;
  let mockBlockConcurrencyWhile: ReturnType<typeof vi.fn>;
  let rateLimiter: RateLimiterDurableObject;

  beforeEach(() => {
    // Mock storage methods
    const storageMap = new Map<string, unknown>();
    const alarmMap = new Map<number, number>();

    mockStorage = {
      get: vi.fn(
        async <T>(key: string): Promise<T | undefined> =>
          storageMap.get(key) as T | undefined
      ),
      put: vi.fn(async (key: string, value: unknown): Promise<void> => {
        storageMap.set(key, value);
      }),
      delete: vi.fn(async (keys: string[]): Promise<void> => {
        for (const key of keys) {
          storageMap.delete(key);
        }
      }),
      list: vi.fn(
        async <T>(): Promise<Map<string, T>> =>
          new Map(storageMap) as Map<string, T>
      ),
      getAlarm: vi.fn(async (): Promise<number | null> => {
        const alarms = Array.from(alarmMap.keys()).sort((a, b) => a - b);
        const firstAlarm = alarms[0];
        return firstAlarm !== undefined ? (firstAlarm as number) : null;
      }),
      setAlarm: vi.fn(async (scheduledTime: number): Promise<void> => {
        alarmMap.set(scheduledTime, scheduledTime);
      }),
      deleteAlarm: vi.fn(async (): Promise<void> => {
        alarmMap.clear();
      }),
    } as unknown as DurableObjectStorage;

    // Mock blockConcurrencyWhile
    mockBlockConcurrencyWhile = vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    });

    // Mock context
    mockCtx = {
      storage: mockStorage,
      blockConcurrencyWhile: mockBlockConcurrencyWhile,
    } as unknown as DurableObjectState;

    // Create instance
    rateLimiter = new RateLimiterDurableObject(mockCtx as any, {});
  });

  describe("constructor", () => {
    it("should initialize storage and context", () => {
      expect(rateLimiter.storage).toBe(mockStorage);
      expect(rateLimiter.ctx).toBe(mockCtx);
    });

    it("should schedule cleanup on construction", () => {
      expect(mockBlockConcurrencyWhile).toHaveBeenCalled();
      expect(mockStorage.setAlarm).toHaveBeenCalled();
    });
  });

  describe("checkLimit", () => {
    const identifier = "test-identifier";
    const max = 10;
    const windowMs = 60_000; // 1 minute

    it("should create a new entry when none exists", async () => {
      const result = await rateLimiter.checkLimit(identifier, max, windowMs);

      expect(result).toEqual({
        success: true,
        remaining: max - 1,
        limit: max,
        reset: expect.any(Number),
      });

      expect(mockStorage.get).toHaveBeenCalledWith(identifier);
      expect(mockStorage.put).toHaveBeenCalledWith(identifier, {
        count: 1,
        timestamp: expect.any(Number),
        windowMs,
      });
    });

    it("should create a new entry when window has expired", async () => {
      // Entry is 1 second past expiration
      await mockStorage.put(identifier, {
        count: 5,
        timestamp: Date.now() - windowMs - 1000, // 1 second past expiration
        windowMs,
      });

      // Check limit should create a new entry
      const result = await rateLimiter.checkLimit(identifier, max, windowMs);

      expect(result).toMatchObject({
        success: true,
        remaining: max - 1,
      });

      const entry = await mockStorage.get<{ count: number }>(identifier);
      expect(entry?.count).toBe(1);
    });

    it("should increment count when under limit", async () => {
      const now = Date.now();
      await mockStorage.put(identifier, {
        count: 3,
        timestamp: now,
        windowMs,
      });

      const result = await rateLimiter.checkLimit(identifier, max, windowMs);
      expect(result).toMatchObject({
        success: true,
        remaining: max - 4, // 10 - 4 = 6
      });

      expect(mockStorage.put).toHaveBeenCalledWith(identifier, {
        count: 4,
        timestamp: now,
        windowMs,
      });
    });

    it("should return failure when at limit", async () => {
      const now = Date.now();
      await mockStorage.put(identifier, {
        count: max,
        timestamp: now,
        windowMs,
      });

      const result = await rateLimiter.checkLimit(identifier, max, windowMs);
      expect(result).toEqual({
        success: false,
        remaining: 0,
        reset: now + windowMs,
        limit: max,
      });

      // Should not increment count when at limit
      expect(mockStorage.put).not.toHaveBeenCalledWith(
        identifier,
        expect.objectContaining({ count: max + 1 })
      );
    });

    it("should return failure when over limit", async () => {
      const now = Date.now();
      await mockStorage.put(identifier, {
        count: max + 5,
        timestamp: now,
        windowMs,
      });

      const result = await rateLimiter.checkLimit(identifier, max, windowMs);
      expect(result).toMatchObject({
        success: false,
        remaining: 0,
      });
    });

    it("should update windowMs when it changes", async () => {
      const now = Date.now();
      const oldWindowMs = 30_000;
      const newWindowMs = 120_000; // 2 minutes

      await mockStorage.put(identifier, {
        count: 2,
        timestamp: now,
        windowMs: oldWindowMs,
      });

      await rateLimiter.checkLimit(identifier, max, newWindowMs);

      expect(mockStorage.put).toHaveBeenCalledWith(identifier, {
        count: 3,
        timestamp: now,
        windowMs: newWindowMs,
      });
    });

    it("should calculate reset time correctly", async () => {
      const now = Date.now();
      const timestamp = now - 10_000; // 10 seconds ago

      await mockStorage.put(identifier, {
        count: 1,
        timestamp,
        windowMs,
      });

      const result = await rateLimiter.checkLimit(identifier, max, windowMs);

      expect(result).toMatchObject({
        reset: timestamp + windowMs,
      });
    });

    /**
     * It really should not actually because each durable object is unique per identifier,
     *   but it's a nice to have for testing.
     */
    it("should handle multiple identifiers independently", async () => {
      const id1 = "identifier-1";
      const id2 = "identifier-2";

      await rateLimiter.checkLimit(id1, max, windowMs);
      await rateLimiter.checkLimit(id2, max, windowMs);
      await rateLimiter.checkLimit(id1, max, windowMs);

      const entry1 = await mockStorage.get<{ count: number }>(id1);
      const entry2 = await mockStorage.get<{ count: number }>(id2);

      expect(entry1).toMatchObject({ count: 2 });
      expect(entry2).toMatchObject({ count: 1 });
    });
  });

  describe("alarm", () => {
    it("should delete expired entries", async () => {
      const now = Date.now();
      const expiredTimestamp = now - 200_000; // 200 seconds ago
      const validTimestamp = now - 10_000; // 10 seconds ago
      const windowMs = 60_000; // 1 minute

      await mockStorage.put("expired-1", {
        count: 5,
        timestamp: expiredTimestamp,
        windowMs,
      });
      await mockStorage.put("expired-2", {
        count: 3,
        timestamp: expiredTimestamp,
        windowMs,
      });
      await mockStorage.put("valid-1", {
        count: 2,
        timestamp: validTimestamp,
        windowMs,
      });

      // Mock Date.now to return a fixed time
      const originalDateNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(now);

      await rateLimiter.alarm();

      expect(mockStorage.delete).toHaveBeenCalledWith(
        expect.arrayContaining(["expired-1", "expired-2"])
      );
      expect(mockStorage.delete).not.toHaveBeenCalledWith(
        expect.arrayContaining(["valid-1"])
      );

      // Restore Date.now
      Date.now = originalDateNow;
    });

    it("should keep non-expired entries", async () => {
      const now = Date.now();
      const validTimestamp = now - 10_000; // 10 seconds ago
      const windowMs = 60_000; // 1 minute

      await mockStorage.put("valid-1", {
        count: 2,
        timestamp: validTimestamp,
        windowMs,
      });
      await mockStorage.put("valid-2", {
        count: 5,
        timestamp: validTimestamp,
        windowMs,
      });

      const originalDateNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(now);

      await rateLimiter.alarm();

      const entry1 = await mockStorage.get("valid-1");
      const entry2 = await mockStorage.get("valid-2");

      expect(entry1).toBeDefined();
      expect(entry2).toBeDefined();

      Date.now = originalDateNow;
    });

    it("should not call delete when no entries are expired", async () => {
      const now = Date.now();
      const validTimestamp = now - 10_000;
      const windowMs = 60_000;

      await mockStorage.put("valid-1", {
        count: 1,
        timestamp: validTimestamp,
        windowMs,
      });

      const originalDateNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(now);

      await rateLimiter.alarm();

      expect(mockStorage.delete).not.toHaveBeenCalled();

      Date.now = originalDateNow;
    });

    it("should reschedule the next cleanup", async () => {
      const now = Date.now();
      const originalDateNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(now);

      await rateLimiter.alarm();

      expect(mockStorage.setAlarm).toHaveBeenCalledWith(expect.any(Number));
      const setAlarmCall = (mockStorage.setAlarm as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[0];
      if (setAlarmCall !== undefined) {
        expect(setAlarmCall).toBeGreaterThan(now);
      }

      Date.now = originalDateNow;
    });

    it("should handle empty storage", async () => {
      const originalDateNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(Date.now());

      await rateLimiter.alarm();

      expect(mockStorage.list).toHaveBeenCalled();
      expect(mockStorage.delete).not.toHaveBeenCalled();
      expect(mockStorage.setAlarm).toHaveBeenCalled();

      Date.now = originalDateNow;
    });

    it("should use blockConcurrencyWhile during alarm", async () => {
      await rateLimiter.alarm();

      expect(mockBlockConcurrencyWhile).toHaveBeenCalled();
    });
  });

  describe("scheduleCleanup", () => {
    it("should set alarm if none exists", async () => {
      // Create a new instance to test scheduleCleanup
      const newMockStorage = {
        ...mockStorage,
        getAlarm: vi.fn(async () => null),
        setAlarm: vi.fn(async () => {
          // Mock implementation
        }),
      } as unknown as DurableObjectStorage;

      const newMockBlockConcurrencyWhile = vi.fn(
        async (fn: () => Promise<void>) => {
          await fn();
        }
      );

      const newMockCtx = {
        ...mockCtx,
        storage: newMockStorage,
        blockConcurrencyWhile: newMockBlockConcurrencyWhile,
      } as unknown as DurableObjectState;

      new RateLimiterDurableObject(newMockCtx as any, {});

      // Wait for blockConcurrencyWhile to complete
      await newMockBlockConcurrencyWhile.mock.results[0]?.value;

      expect(newMockStorage.setAlarm).toHaveBeenCalled();
    });

    it("should not set alarm if one already exists", () => {
      const existingAlarmTime = Date.now() + 100_000;
      const newMockStorage = {
        ...mockStorage,
        getAlarm: vi.fn(async () => existingAlarmTime),
        setAlarm: vi.fn(async () => {
          // Mock implementation
        }),
      } as unknown as DurableObjectStorage;

      const newMockCtx = {
        ...mockCtx,
        storage: newMockStorage,
      } as unknown as DurableObjectState;

      new RateLimiterDurableObject(newMockCtx as any, {});

      expect(newMockStorage.setAlarm).not.toHaveBeenCalled();
    });
  });
});
