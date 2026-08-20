/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type { AnyComponents } from "convex/server";
import type * as audit from "../audit.js";
import type * as contacts from "../contacts.js";
import type * as expenses from "../expenses.js";
import type * as grants from "../grants.js";
import type * as income from "../income.js";
import type * as lib from "../lib.js";
import type * as seed from "../seed.js";
import type * as sponsors from "../sponsors.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "audit": typeof audit,
  "contacts": typeof contacts,
  "expenses": typeof expenses,
  "grants": typeof grants,
  "income": typeof income,
  "lib": typeof lib,
  "seed": typeof seed,
  "sponsors": typeof sponsors,
  "users": typeof users,
  "validators": typeof validators,
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: AnyComponents;
