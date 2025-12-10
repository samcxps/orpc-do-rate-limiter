import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareDurableRateLimiter } from "./adapter";
import type { RateLimiterDurableObject } from "./durable-object";

type RateLimitResult = {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
};

type DurableObjectStub = {
  checkLimit: (
    identifier: string,
    max: number,
    windowMs: number
  ) => Promise<RateLimitResult>;
};

describe("CloudflareDurableRateLimiter", () => {
  let mockNamespace: DurableObjectNamespace<RateLimiterDurableObject>;
  let mockStub: DurableObjectStub;
  let mockCheckLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCheckLimit = vi.fn();
    mockStub = {
      checkLimit: mockCheckLimit as (
        identifier: string,
        max: number,
        windowMs: number
      ) => Promise<RateLimitResult>,
    };

    mockNamespace = {
      getByName: vi.fn(() => mockStub),
    } as any;
  });

  describe("limit", () => {
    const maxRequests = 10;
    const window = 60_000;

    beforeEach(() => {
      mockCheckLimit.mockResolvedValue({
        success: true,
        remaining: 9,
        reset: Date.now() + window,
        limit: maxRequests,
      });
    });

    it("should use default prefix when not provided", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const key = "test-key";
      await rateLimiter.limit(key);

      expect(mockNamespace.getByName).toHaveBeenCalledWith(
        `orpc:ratelimit:${key}`
      );
    });

    it("should use custom prefix when provided", async () => {
      const customPrefix = "custom:prefix:";
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        prefix: customPrefix,
        maxRequests,
        window,
      });

      const key = "test-key";
      await rateLimiter.limit(key);

      expect(mockNamespace.getByName).toHaveBeenCalledWith(
        `${customPrefix}${key}`
      );
    });

    it("should call getByName with prefixed key", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const key = "user-123";
      await rateLimiter.limit(key);

      expect(mockNamespace.getByName).toHaveBeenCalledWith(
        `orpc:ratelimit:${key}`
      );
      expect(mockNamespace.getByName).toHaveBeenCalledTimes(1);
    });

    it("should call checkLimit on stub with correct parameters", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const key = "test-key";
      await rateLimiter.limit(key);

      expect(mockCheckLimit).toHaveBeenCalledWith(
        `orpc:ratelimit:${key}`,
        maxRequests,
        window
      );
      expect(mockCheckLimit).toHaveBeenCalledTimes(1);
    });

    it("should return the result from checkLimit", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const expectedResult = {
        success: true,
        remaining: 5,
        reset: Date.now() + window,
        limit: maxRequests,
      };
      mockCheckLimit.mockResolvedValue(expectedResult);

      const result = await rateLimiter.limit("test-key");
      expect(result).toEqual(expectedResult);
    });

    it("should handle different keys independently", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      await rateLimiter.limit("key-1");
      await rateLimiter.limit("key-2");
      await rateLimiter.limit("key-1");

      expect(mockNamespace.getByName).toHaveBeenCalledWith(
        "orpc:ratelimit:key-1"
      );
      expect(mockNamespace.getByName).toHaveBeenCalledWith(
        "orpc:ratelimit:key-2"
      );
      expect(mockNamespace.getByName).toHaveBeenCalledTimes(3);
      expect(mockCheckLimit).toHaveBeenCalledTimes(3);
    });

    it("should handle keys with special characters", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const specialKey = "user@example.com:api-key";
      await rateLimiter.limit(specialKey);

      expect(mockNamespace.getByName).toHaveBeenCalledWith(
        `orpc:ratelimit:${specialKey}`
      );
    });

    it("should throw an error when key is empty", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      await expect(rateLimiter.limit("")).rejects.toThrow(
        "Key cannot be empty"
      );
    });

    it("should propagate errors from checkLimit", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const error = new Error("Durable object error");
      mockCheckLimit.mockRejectedValue(error);

      await expect(rateLimiter.limit("test-key")).rejects.toThrow(
        "Durable object error"
      );
    });

    it("should handle concurrent limit calls", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      const promises = [
        rateLimiter.limit("key-1"),
        rateLimiter.limit("key-2"),
        rateLimiter.limit("key-3"),
      ];

      await Promise.all(promises);

      expect(mockCheckLimit).toHaveBeenCalledTimes(3);
    });

    it("should use the same stub for the same prefixed key", async () => {
      const rateLimiter = new CloudflareDurableRateLimiter(mockNamespace, {
        maxRequests,
        window,
      });

      await rateLimiter.limit("same-key");
      await rateLimiter.limit("same-key");

      // getByName should be called twice (once per limit call)
      // but both times with the same prefixed key
      expect(mockNamespace.getByName).toHaveBeenCalledTimes(2);
      expect(mockNamespace.getByName).toHaveBeenNthCalledWith(
        1,
        "orpc:ratelimit:same-key"
      );
      expect(mockNamespace.getByName).toHaveBeenNthCalledWith(
        2,
        "orpc:ratelimit:same-key"
      );
    });
  });
});
