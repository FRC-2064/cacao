/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as donorNames from "../donorNames.js";
import type * as donors from "../donors.js";
import type * as expenses from "../expenses.js";
import type * as grants from "../grants.js";
import type * as hcbCategories from "../hcbCategories.js";
import type * as http from "../http.js";
import type * as income from "../income.js";
import type * as lib from "../lib.js";
import type * as personNames from "../personNames.js";
import type * as seasons from "../seasons.js";
import type * as sessions from "../sessions.js";
import type * as sponsors from "../sponsors.js";
import type * as teamInfo from "../teamInfo.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as wishlist from "../wishlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  audit: typeof audit;
  auth: typeof auth;
  contacts: typeof contacts;
  crons: typeof crons;
  donorNames: typeof donorNames;
  donors: typeof donors;
  expenses: typeof expenses;
  grants: typeof grants;
  hcbCategories: typeof hcbCategories;
  http: typeof http;
  income: typeof income;
  lib: typeof lib;
  personNames: typeof personNames;
  seasons: typeof seasons;
  sessions: typeof sessions;
  sponsors: typeof sponsors;
  teamInfo: typeof teamInfo;
  users: typeof users;
  validators: typeof validators;
  wishlist: typeof wishlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
