import { nanoid } from "nanoid";
import { LockNotGrantedError } from "./errors";
import { Lock } from "./lock";
import { locker, testLocker } from "./locker.jest";

describe("locker", () => {
  describe("acquire()", () => {
    it("should return an acquried lock", async () => {
      const lock = await locker.acquire(nanoid(), { leaseDurationMs: 10000 });
      expect(lock).toBeInstanceOf(Lock);
      expect(lock.isAcquired).toBeTruthy();
    });
  });

  describe("withLock()", () => {
    it("should run method within a lock, ensuring the lock is released afterwards", async () => {
      let currentLock: Lock | undefined;

      const value = await locker.withLock(nanoid(), { leaseDurationMs: 10000 }, async (lock) => {
        currentLock = lock;
        expect(lock.isAcquired).toBeTruthy();
        return "VALUE";
      });

      expect(value).toEqual("VALUE");
      expect(currentLock?.isAcquired).toBeFalsy();
    });

    it("shouldn't run if a lock can't be acquired", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;
      const otherLocker = testLocker();
      const otherLock = await otherLocker.acquire(leaseId, { leaseDurationMs, heartbeatMs: leaseDurationMs / 3 });
      expect(otherLock.isAcquired).toBeTruthy();

      let currentLock: Lock | undefined;
      await expect(async () => {
        const value = await locker.withLock(leaseId, { leaseDurationMs: 10000 }, async (lock) => {
          currentLock = lock;
          return "NEVER RETURNED";
        });
        expect(value).toBeUndefined();
      }).rejects.toThrow(LockNotGrantedError);

      expect(currentLock).toBeUndefined();
      await otherLock.release();
    });
  }); 

  describe("withLocks", () => {
    it("should acquire and release all locks when available", async () => {
      const leaseIds = [nanoid(), nanoid(), nanoid()];
      let currentLocks: Lock[] = [];
      
      const value = await locker.withLocks(leaseIds, { leaseDurationMs: 10000 }, async (locks) => {
        currentLocks = locks;
        locks.forEach(lock => expect(lock.isAcquired).toBeTruthy());
        return "VALUE";
      });

      expect(value).toEqual("VALUE");
      expect(currentLocks).toHaveLength(3);
      currentLocks.forEach(lock => expect(lock.isAcquired).toBeFalsy());
    });

    it("should acquire and release all locks even if callback throws an error", async () => {
      const leaseIds = [nanoid(), nanoid(), nanoid()];
      let currentLocks: Lock[] = [];

      await expect(async () => {
        await locker.withLocks(leaseIds, { leaseDurationMs: 10000 }, async (locks) => {
          currentLocks = locks;
          locks.forEach(lock => expect(lock.isAcquired).toBeTruthy());
          throw new Error("FAILED")
        });
      }).rejects.toThrow("FAILED");

      expect(currentLocks).toHaveLength(3);
      currentLocks.forEach(lock => expect(lock.isAcquired).toBeFalsy());
    });

    it("wait for all locks to become available if within maxRetryCount", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;
      const otherLocker = testLocker();
      const otherLock = await otherLocker.acquire(leaseId, { leaseDurationMs, heartbeatMs: leaseDurationMs / 3 });
      expect(otherLock.isAcquired).toBeTruthy();
      setTimeout(async () => {
        await otherLock.release();
      }, leaseDurationMs * 2 + 1);

      const startTime = Date.now();
      const value = await locker.withLocks([ nanoid(), leaseId, nanoid() ], { leaseDurationMs: 10000 }, async () => {
        return "VALUE";
      });
      const executionDuration = Date.now() - startTime;
      expect(executionDuration).toBeGreaterThan(leaseDurationMs * 2 - 1);

      expect(value).toEqual("VALUE");
    });

    it("should fail if can't get all locks within maxRetryCount", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;
      const otherLocker = testLocker();
      const otherLock = await otherLocker.acquire(leaseId, { leaseDurationMs, heartbeatMs: leaseDurationMs / 3 });
      expect(otherLock.isAcquired).toBeTruthy();

      let currentLocks: Lock[] = [];
      await expect(async () => {
        const value = await locker.withLocks([ nanoid(), leaseId, nanoid()], { leaseDurationMs: 10000, maxRetryCount: 10 }, async (locks) => {
          currentLocks = locks;
          return "NEVER RETURNED";
        });
        expect(value).toBeUndefined();
      }).rejects.toThrow(LockNotGrantedError);

      expect(currentLocks).toHaveLength(0);
      await otherLock.release();
    });
  });
});