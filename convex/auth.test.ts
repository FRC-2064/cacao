/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

test('an unauthenticated caller is not an actor', async () => {
  const t = convexTest(schema, modules);
  const user = await t.query(api.users.me, {});
  expect(user).toBeNull();
});
