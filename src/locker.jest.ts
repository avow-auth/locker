import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Locker } from "./locker";

const defaultLockerConfig = {
  tableName: "locker-test",
  partitionKeyPrefix: "test-prefix#",
  partitionKey: "pk",
  sortKey: "sk",
  ttlKey: "expiresAt",
  ddbClient: new DynamoDBClient({
    endpoint: 'http://localhost:8124',
    region: 'local-env',
    credentials: {
      accessKeyId: 'fakeMyKeyId',
      secretAccessKey: 'fakeSecretAccessKey',
    },
  }),
};

export function testLocker(overrides: { ownerId?: string } = {}) {
  return new Locker({
    ...defaultLockerConfig,
    ...overrides,
  });
}

export const locker = testLocker();