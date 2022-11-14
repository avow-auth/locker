/**
 * @type {import('@shelf/jest-dynamodb/lib').Config}')}
 */
const config = {
  tables: [
    {
      TableName: `locker-test`,
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
    },
    // etc
  ],
  options: ["-inMemory"],
  port: 8124,
};

module.exports = config;
