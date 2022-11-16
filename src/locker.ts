import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { nanoid } from "nanoid";
import { Lease, LeaseOptions } from "./lease";

export type LockerOptions = {
  ddbClient?: DynamoDBClient;
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
   * @throws LeaseNotGrantedError 
   */
  async acquire(leaseId: string, options: LeaseOptions): Promise<Lease> {
    const lease = new Lease(leaseId, { ...options, locker: this });
    await lease.acquire();
    return lease;
  }

  async withLease<R>(leaseId: string, options: LeaseOptions, callback: (lease: Lease) => Promise<R>) {
    const lease = await this.acquire(leaseId, options);
    try {
      return await callback(lease);
    } finally {
      await lease.release();
    }
  }

  async withLeases<R>(leaseIds: string[], options: LeaseOptions, callback: (leases: Lease[]) => Promise<R>) {
    const leases = await Promise.all(leaseIds.map(leaseId => this.acquire(leaseId, options)));
    try {
      return await callback(leases);
    } finally {
      await Promise.all(leases.map(lease => lease.release()));
    }
  }
}