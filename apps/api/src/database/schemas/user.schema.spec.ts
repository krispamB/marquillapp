import { UserSchema } from './user.schema';

describe('UserSchema', () => {
  it.each([
    ['googleId', 'user_google_id_unique'],
    ['clerkId', 'user_clerk_id_unique'],
  ])(
    'should only enforce uniqueness for string %s values',
    (field, expectedName) => {
      const index = UserSchema.indexes().find(([keys]) => keys[field] === 1);

      expect(index).toBeDefined();
      expect(index?.[1]).toMatchObject({
        name: expectedName,
        unique: true,
        partialFilterExpression: {
          [field]: { $type: 'string' },
        },
      });
      expect(index?.[1]).not.toHaveProperty('sparse');
    },
  );
});
