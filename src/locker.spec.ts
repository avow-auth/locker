import { nanoid } from "nanoid";
import { LeaseNotGrantedError } from "./errors";
import { Lease } from "./lease";
import { locker, testLocker } from "./locker.jest";

describe("locker", () => {
  describe("acquire()", () => {
    it("should return an acquried lock", async () => {
      const lease = await locker.acquire(nanoid(), { leaseDurationMs: 10000 });
      expect(lease).toBeInstanceOf(Lease);
      expect(lease.isAcquired).toBeTruthy();
    });
  });

  describe("withLease()", () => {
    it("should run method within a lock, ensuring the lock is released afterwards", async () => {
      let currentLease: Lease | undefined;

      const value = await locker.withLease(nanoid(), { leaseDurationMs: 10000 }, async (lease) => {
        currentLease = lease;
        expect(lease.isAcquired).toBeTruthy();
        return "VALUE";
      });

      expect(value).toEqual("VALUE");
      expect(currentLease?.isAcquired).toBeFalsy();
    });

    it("shouldn't run if a lock can't be acquired", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;
      const otherLocker = testLocker();
      const otherLease = await otherLocker.acquire(leaseId, { leaseDurationMs, heartbeatMs: leaseDurationMs / 3 });
      expect(otherLease.isAcquired).toBeTruthy();

      let currentLease: Lease | undefined;
      await expect(async () => {
        const value = await locker.withLease(leaseId, { leaseDurationMs: 10000 }, async (lease) => {
          currentLease = lease;
          return "NEVER RETURNED";
        });
        expect(value).toBeUndefined();
      }).rejects.toThrow(LeaseNotGrantedError);

      expect(currentLease).toBeUndefined();
      await otherLease.release();
    });
  }); 

  describe("withLeases", () => {
    it("should acquire and release all locks when available", async () => {
      const leaseIds = [nanoid(), nanoid(), nanoid()];
      let currentLeases: Lease[] = [];
      
      const value = await locker.withLeases(leaseIds, { leaseDurationMs: 10000 }, async (leases) => {
        currentLeases = leases;
        leases.forEach(lease => expect(lease.isAcquired).toBeTruthy());
        return "VALUE";
      });

      expect(value).toEqual("VALUE");
      expect(currentLeases).toHaveLength(3);
      currentLeases.forEach(lease => expect(lease.isAcquired).toBeFalsy());
    });

    it("should acquire and release all locks even if callback throws an error", async () => {
      const leaseIds = [nanoid(), nanoid(), nanoid()];
      let currentLeases: Lease[] = [];

      await expect(async () => {
        await locker.withLeases(leaseIds, { leaseDurationMs: 10000 }, async (leases) => {
          currentLeases = leases;
          leases.forEach(lease => expect(lease.isAcquired).toBeTruthy());
          throw new Error("FAILED")
        });
      }).rejects.toThrow("FAILED");

      expect(currentLeases).toHaveLength(3);
      currentLeases.forEach(lock => expect(lock.isAcquired).toBeFalsy());
    });

    it("wait for all locks to become available if within maxRetryCount", async () => {
      const leaseId = nanoid();
      const leaseDurationMs = 200;
      const otherLocker = testLocker();
      const otherLease = await otherLocker.acquire(leaseId, { leaseDurationMs, heartbeatMs: leaseDurationMs / 3 });
      expect(otherLease.isAcquired).toBeTruthy();
      setTimeout(async () => {
        await otherLease.release();
      }, leaseDurationMs * 2 + 1);

      const startTime = Date.now();
      const value = await locker.withLeases([ nanoid(), leaseId, nanoid() ], { leaseDurationMs: 10000 }, async () => {
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
      const otherLease = await otherLocker.acquire(leaseId, { leaseDurationMs, heartbeatMs: leaseDurationMs / 3 });
      expect(otherLease.isAcquired).toBeTruthy();

      let currentLeases: Lease[] = [];
      await expect(async () => {
        const value = await locker.withLeases([ nanoid(), leaseId, nanoid()], { leaseDurationMs: 10000, maxRetryCount: 10 }, async (leases) => {
          currentLeases = leases;
          return "NEVER RETURNED";
        });
        expect(value).toBeUndefined();
      }).rejects.toThrow(LeaseNotGrantedError);

      expect(currentLeases).toHaveLength(0);
      await otherLease.release();
    });
  });
});