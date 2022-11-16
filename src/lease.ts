import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import Debug from "debug";
import { nanoid } from "nanoid";
import { setTimeout as delay } from "timers/promises";
import { LeaseNotGrantedError } from "./errors";
import { Locker } from "./locker";

const debug = Debug("locker:lease");

export const DEFAULT_RETRY_COUNT = 5;

export type LeaseOptions = {
  leaseDurationMs: number;
  heartbeatMs?: number;
  maxRetryCount?: number;
}

export type LeaseOptionsWithLocker = LeaseOptions & {
  locker: Locker;
}

export type LeaseItem = {
  leaseId: string;
  ownerId: string;
  durationMs: number;
  version: string;
}

export class Lease {
  locker: Locker;

  leaseId: string;
  leaseKey: { [x: string]: string; };
  leaseDurationMs: number;
  heartbeatMs: number | undefined;
  maxRetryCount: number;

  isAcquired: boolean = false;
  version: string | undefined;
  heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(leaseId: string, { 
    locker,
    leaseDurationMs, 
    heartbeatMs, 
    maxRetryCount,
  }: LeaseOptionsWithLocker) {
    this.locker = locker;

    this.leaseId = leaseId;
    this.leaseDurationMs = leaseDurationMs;
    this.heartbeatMs = heartbeatMs;
    this.maxRetryCount = maxRetryCount ?? DEFAULT_RETRY_COUNT;

    this.leaseKey = {
      [this.locker.partitionKey]: this.locker.partitionKeyPrefix + leaseId
    };

    if (this.locker.sortKey) {
      this.leaseKey[this.locker.sortKey] = "*";
    }
  }

  /**
   * @throws LockNotGrantedError
   */
  async acquire(): Promise<void> {
    if (this.isAcquired) {
      throw new LeaseNotGrantedError(`${this.leaseId} already acquired`);   
    }

    for (let attempt = 0; attempt < this.maxRetryCount; attempt++) {
      const lockItem = await this.fetchLease();

      // If lock already exists attempt to wait durationMs to expire before acquiring
      if (lockItem) {
        await delay(lockItem.durationMs);
      }

      const acquired = await this.upsertLease(lockItem?.version); // use previous lock version to steal if it exists
      if (acquired) {
        this.scheduleHeartbeat();
        return;
      }
    }

    throw new LeaseNotGrantedError(`${this.leaseId} could not be acquired after ${this.maxRetryCount} attempts`);
  }

  async release(): Promise<void> {
    // Clear attributes immediately, regardless of DDB operations
    this.isAcquired = false;
    this.cancelHeartbeat();

    if (this.version) {
      try {
        await this.locker.ddbDocClient.send(
          new DeleteCommand({
            TableName: this.locker.tableName,
            Key: this.leaseKey,
            ConditionExpression: "version = :version",
            ExpressionAttributeValues: {
              ":version": this.version,
            }
          })
        );

        this.version = undefined;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
          debug(`Tried to relaese ${this.leaseId} but already expired or released`);  
        } else {
          throw err;
        }
      }
    }
  }

  private scheduleHeartbeat() {
    if (this.heartbeatMs) {
      this.heartbeatTimer = setTimeout(async () => {
        const updated = await this.upsertLease();
        if (updated) {
          this.scheduleHeartbeat();
        } else {
          this.isAcquired = false;
        }
      }, this.heartbeatMs);
    }
  }

  private cancelHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Creates or updates the lock. 
   * 
   * When attempting to steal a lock, pass the `existingVersion` of the lock to steal.
   * 
   * @param existingVersion optionally override the existing version to use in the conditional, will default to the current lock version
   */
  private async upsertLease(existingVersion?: string): Promise<boolean> {
    try {
      const newVersion = nanoid();
      const oldVersion = existingVersion ?? this.version;

      await this.locker.ddbDocClient.send(
        new UpdateCommand({
          TableName: this.locker.tableName,
          Key: this.leaseKey,
          UpdateExpression: "SET version = :newVersion, ownerId = :ownerId, durationMs = :durationMs, #ttl = :ttl",
          ConditionExpression: `${oldVersion ? "version = :oldVersion OR " : ""}attribute_not_exists(version)`,
          ExpressionAttributeNames: {
            "#ttl": this.locker.ttlKey,
          },
          ExpressionAttributeValues: {
            ":ttl": (Date.now() + this.leaseDurationMs * 3) / 1000, // set expiry 3x leaseDurationMs
            ":ownerId": this.locker.ownerId,
            ":durationMs": this.leaseDurationMs,
            ":newVersion": newVersion,
            ...(oldVersion && { ":oldVersion": oldVersion }),
          }
        })
      );

      this.isAcquired = true;
      this.version = newVersion;

      return true;
    } catch (err) {
      this.isAcquired = false;
      this.version = undefined;

      if (err instanceof ConditionalCheckFailedException) {
        debug(`Lease acquisition failed because lease for ${this.leaseId} already exists`);
        return false;
      } else {
        throw err;
      }
    }
  }

  private async fetchLease(): Promise<LeaseItem | undefined> {
    const { Item } = await this.locker.ddbDocClient.send(
      new GetCommand({
        TableName: this.locker.tableName,
        Key: this.leaseKey,
        ConsistentRead: true,
      }
    ));

    if (Item && Item[this.locker.ttlKey] > (Date.now() / 1000)) {
      return {
        leaseId: this.leaseId,
        ownerId: Item.ownerId,
        durationMs: Item.durationMs,
        version:  Item.version,
      }
    }
  }
}