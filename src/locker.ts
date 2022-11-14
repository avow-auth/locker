import { DynamoDB, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { nanoid } from "nanoid";
import { Lock, LockOptions } from "./lock";

export type LockerOptions = {
  ddbClient?: DynamoDBClient | DynamoDB;
  tableName: string;
  partitionKeyPrefix?: string;
  partitionKey: string;
  sortKey?: string;
  ttlKey: string;
  defaultHeartbeatMs?: number; // auto-extends lease by updating version number every heartbeatMs
  ownerId?: string;
}

export class Locker {
  ddbClient: DynamoDBClient;
  ddbDocClient: DynamoDBDocumentClient;
  tableName: string;
  partitionKeyPrefix: string;
  partitionKey: string;
  sortKey: string | undefined;
  ttlKey: string;
  defaultHeartbeatMs: number | undefined;

  ownerId: string;

  constructor({
    ddbClient,
    tableName,
    partitionKeyPrefix,
    partitionKey,
    sortKey,
    ttlKey,
    defaultHeartbeatMs,
    ownerId,
  }: LockerOptions) {
    this.ddbClient = ddbClient ?? new DynamoDBClient({});
    this.ddbDocClient = DynamoDBDocumentClient.from(this.ddbClient, { marshallOptions: { removeUndefinedValues: true } });
    this.tableName = tableName;
    this.partitionKeyPrefix = partitionKeyPrefix ?? "";
    this.partitionKey = partitionKey;
    this.sortKey = sortKey;
    this.ttlKey = ttlKey;
    this.defaultHeartbeatMs = defaultHeartbeatMs;

    this.ownerId = ownerId ?? nanoid();
  }

  /**
   * 
   * @param leaseId 
   * @param options
   * @throws LockNotGrantedError 
   */
  async acquire(leaseId: string, options: LockOptions): Promise<Lock> {
    const lock = new Lock(leaseId, { ...options, locker: this });
    await lock.acquire();
    return lock;
  }

  async withLock<R>(leaseId: string, options: LockOptions, callback: (lock: Lock) => Promise<R>) {
    const lock = await this.acquire(leaseId, options);
    try {
      return await callback(lock);
    } finally {
      await lock.release();
    }
  }

  async withLocks<R>(leaseIds: string[], options: LockOptions, callback: (locks: Lock[]) => Promise<R>) {
    const locks = await Promise.all(leaseIds.map(leaseId => this.acquire(leaseId, options)));
    try {
      return await callback(locks);
    } finally {
      await Promise.all(locks.map(lock => lock.release()));
    }
  }
}