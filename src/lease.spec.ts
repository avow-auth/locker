import { nanoid } from "nanoid";
import { setTimeout as delay } from "timers/promises";
import { LeaseNotGrantedError } from "./errors";
import { DEFAULT_RETRY_COUNT, Lease } from "./lease";
import { locker, testLocker } from "./locker.jest";

describe("Lease", () => {
  describe("constructor", () => {
    describe("maxRetryCount", () => {
      it("should be DEFAULT_RETRY_COUNT if not specified", () => {
        const lease = new Lease("test", { locker, leaseDurationMs: 500 });
        expect(lease.maxRetryCount).toEqual(DEFAULT_RETRY_COUNT);
      });

      it("should be specified value", () => {
        const lease = new Lease("test", { maxRetryCount: 1001, locker, leaseDurationMs: 500 });
        expect(lease.maxRetryCount).toEqual(1001);
      });
    });

    describe("leaseKey", () => {
      const lease = new Lease("lease-id", { locker, leaseDurationMs: 500 });

      it("partition key should include prefix", () => {
        expect(lease.leaseKey.pk).toEqual(locker.partitionKeyPrefix + "lease-id");
      });

      it("sort key should be * if required", () => {
        expect(lease.leaseKey.sk).toEqual("*");
      });
    });
  });

  describe("acquire()", () => {
    it("should acquire a lock if not acquired by anything else", async () => {
      const lease = new Lease(nanoid(), { locker, leaseDurationMs: 500 });
      await lease.acquire();
      expect(lease.isAcquired).toBeTruthy();
      expect(lease.version).not.toBeUndefined();
    });

    it("should throw error if already acquired", async () => {
      const lease = new Lease(nanoid(), { locker, leaseDurationMs: 500 });
      await lease.acquire();

      expect(lease.isAcquired).toBeTruthy();

      await expect(async () => {
        await lease.acquire();
      }).rejects.toThrow(LeaseNotGrantedError);
    });

    it("should acquire lease after multiple attempts if previous owner relases", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 500;

      const otherLocker = testLocker();
      const otherLease = new Lease(leaseId, {
        locker: otherLocker,
        leaseDurationMs,
        heartbeatMs: leaseDurationMs / 3, // keep renewing so future lock attempt will fail
      });
      await otherLease.acquire();
      expect(otherLease.isAcquired).toBeTruthy();

      // release after leaseDuration * 2
      setTimeout(async () => {
        await otherLease.release();
      }, leaseDurationMs * 2);

      const lease = new Lease(leaseId, {
        locker,
        leaseDurationMs,
        maxRetryCount: 30,
      });

      const startTime = Date.now();
      await lease.acquire();
      const attemptDuration = Date.now() - startTime;

      expect(lease.isAcquired).toBeTruthy();
      expect(attemptDuration).toBeGreaterThan(leaseDurationMs * 2 - 1);
    });

    it("should throw error if acquiring a lock leased to another locker", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;

      const otherLocker = testLocker();
      const otherLease = new Lease(leaseId, { 
        locker: otherLocker, 
        leaseDurationMs, 
        heartbeatMs: leaseDurationMs / 3, // keep renewing so future lock attempt will fail
      });
      await otherLease.acquire();
      expect(otherLease.isAcquired).toBeTruthy();

      const lease = new Lease(leaseId, { 
        locker, 
        leaseDurationMs, 
        maxRetryCount: 3,
      });

      const startTime = Date.now();
      await expect(async () => {
        await lease.acquire();
      }).rejects.toThrow(/could not be acquired after 3 attempts/);
      const attemptDuration = Date.now() - startTime;
      expect(attemptDuration).toBeGreaterThan(leaseDurationMs * 3 - 1);

      await otherLease.release();

      expect(lease.isAcquired).toBeFalsy();
    });
  });

  describe("release()", () => {
    it("should release an existing lease", async () => {
      const leaseId = nanoid();
      const lease = new Lease(leaseId, { locker, leaseDurationMs: 5000 });
      await lease.acquire();
      expect(lease.isAcquired).toBeTruthy();

      const rawLease = await lease['fetchLease']();
      expect(rawLease?.leaseId).toEqual(leaseId);
      
      await lease.release();
      expect(lease.isAcquired).toBeFalsy();
      expect(lease.version).toBeUndefined();
      const noLease = await lease['fetchLease']();
      expect(noLease).toBeUndefined();
    });

    it("should silently fail if no lease", async () => {
      const leaseId = nanoid();
      const lease = new Lease(leaseId, { locker, leaseDurationMs: 5000 });
      await lease.acquire();
      expect(lease.isAcquired).toBeTruthy();
      

      await lease.release();
      await lease.release();
    });
  });

  describe("private scheduleHeartbeat()", () => {
    it("shouldn't heartbeat if no heartbeatMs", async () => {
      const lease = new Lease(nanoid(), { locker, leaseDurationMs: 5000 });
      await lease.acquire();
      expect(lease.heartbeatTimer).toBeUndefined();
      await delay(100);

      const upsertLease = jest.spyOn(lease as any, "upsertLease");
      expect(upsertLease).not.toHaveBeenCalled();
    });

    it("should call hearbeat every heartbeatMs until released", async () => {
      const lease = new Lease(nanoid(), { 
        locker, 
        leaseDurationMs: 5000,
        heartbeatMs: 100,
      });

      await lease.acquire();
      const oldVersion = lease.version;

      const upsertLease = jest.spyOn(lease as any, "upsertLease");
      await delay(100 * 2 + 1);
      await lease.release();
      expect(lease.heartbeatTimer).toBeUndefined();

      expect(upsertLease).toHaveBeenCalled();
      expect(lease.version).not.toEqual(oldVersion);
    });
  });
});