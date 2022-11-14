import { nanoid } from "nanoid";
import { setTimeout as delay } from "timers/promises";
import { LockNotGrantedError } from "./errors";
import { DEFAULT_RETRY_COUNT, Lock } from "./lock";
import { locker, testLocker } from "./locker.jest";

describe("Lock", () => {
  describe("constructor", () => {
    describe("maxRetryCount", () => {
      it("should be DEFAULT_RETRY_COUNT if not specified", () => {
        const lock = new Lock("test", { locker, leaseDurationMs: 500 });
        expect(lock.maxRetryCount).toEqual(DEFAULT_RETRY_COUNT);
      });

      it("should be specified value", () => {
        const lock = new Lock("test", { maxRetryCount: 1001, locker, leaseDurationMs: 500 });
        expect(lock.maxRetryCount).toEqual(1001);
      });
    });

    describe("leaseKey", () => {
      const lock = new Lock("lease-id", { locker, leaseDurationMs: 500 });

      it("partition key should include prefix", () => {
        expect(lock.leaseKey.pk).toEqual(locker.partitionKeyPrefix + "lease-id");
      });

      it("sort key should be * if required", () => {
        expect(lock.leaseKey.sk).toEqual("*");
      });
    });
  });

  describe("acquire()", () => {
    it("should acquire a lock if not acquired by anything else", async () => {
      const lock = new Lock(nanoid(), { locker, leaseDurationMs: 500 });
      await lock.acquire();
      expect(lock.isAcquired).toBeTruthy();
      expect(lock.version).not.toBeUndefined();
    });

    it("should throw error if already acquired", async () => {
      const lock = new Lock(nanoid(), { locker, leaseDurationMs: 500 });
      await lock.acquire();

      expect(lock.isAcquired).toBeTruthy();

      await expect(async () => {
        await lock.acquire();
      }).rejects.toThrow(LockNotGrantedError);
    });

    it("should acquire lease after multiple attempts if previous owner relases", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 500;

      const otherLocker = testLocker();
      const otherLock = new Lock(leaseId, {
        locker: otherLocker,
        leaseDurationMs,
        heartbeatMs: leaseDurationMs / 3, // keep renewing so future lock attempt will fail
      });
      await otherLock.acquire();
      expect(otherLock.isAcquired).toBeTruthy();

      // release after leaseDuration * 2
      setTimeout(async () => {
        await otherLock.release();
      }, leaseDurationMs * 2);

      const lock = new Lock(leaseId, {
        locker,
        leaseDurationMs,
        maxRetryCount: 30,
      });

      const startTime = Date.now();
      await lock.acquire();
      const attemptDuration = Date.now() - startTime;

      expect(lock.isAcquired).toBeTruthy();
      expect(attemptDuration).toBeGreaterThan(leaseDurationMs * 2 - 1);
    });

    it("should throw error if acquiring a lock leased to another locker", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;

      const otherLocker = testLocker();
      const otherLock = new Lock(leaseId, { 
        locker: otherLocker, 
        leaseDurationMs, 
        heartbeatMs: leaseDurationMs / 3, // keep renewing so future lock attempt will fail
      });
      await otherLock.acquire();
      expect(otherLock.isAcquired).toBeTruthy();

      const lock = new Lock(leaseId, { 
        locker, 
        leaseDurationMs, 
        maxRetryCount: 3,
      });

      const startTime = Date.now();
      await expect(async () => {
        await lock.acquire();
      }).rejects.toThrow(/could not be acquired after 3 attempts/);
      const attemptDuration = Date.now() - startTime;
      expect(attemptDuration).toBeGreaterThan(leaseDurationMs * 3 - 1);

      await otherLock.release();

      expect(lock.isAcquired).toBeFalsy();
    });
  });

  describe("release()", () => {
    it("should release an existing lease", async () => {
      const leaseId = nanoid();
      const lock = new Lock(leaseId, { locker, leaseDurationMs: 5000 });
      await lock.acquire();
      expect(lock.isAcquired).toBeTruthy();

      const rawLease = await lock['fetchLease']();
      expect(rawLease?.leaseId).toEqual(leaseId);
      
      await lock.release();
      expect(lock.isAcquired).toBeFalsy();
      expect(lock.version).toBeUndefined();
      const noLease = await lock['fetchLease']();
      expect(noLease).toBeUndefined();
    });

    it("should silently fail if no lease", async () => {
      const leaseId = nanoid();
      const lock = new Lock(leaseId, { locker, leaseDurationMs: 5000 });
      await lock.acquire();
      expect(lock.isAcquired).toBeTruthy();
      

      await lock.release();
      await lock.release();
    });
  });

  describe("private scheduleHeartbeat()", () => {
    it("shouldn't heartbeat if no heartbeatMs", async () => {
      const lock = new Lock(nanoid(), { locker, leaseDurationMs: 5000 });
      await lock.acquire();
      expect(lock.heartbeatTimer).toBeUndefined();
      await delay(100);

      const upsertLease = jest.spyOn(lock as any, "upsertLease");
      expect(upsertLease).not.toHaveBeenCalled();
    });

    it("should call hearbeat every heartbeatMs until released", async () => {
      const lock = new Lock(nanoid(), { 
        locker, 
        leaseDurationMs: 5000,
        heartbeatMs: 100,
      });

      await lock.acquire();
      const oldVersion = lock.version;

      const upsertLease = jest.spyOn(lock as any, "upsertLease");
      await delay(100 * 2 + 1);
      await lock.release();
      expect(lock.heartbeatTimer).toBeUndefined();

      expect(upsertLease).toHaveBeenCalled();
      expect(lock.version).not.toEqual(oldVersion);
    });
  });
});