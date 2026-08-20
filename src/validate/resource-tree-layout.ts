import { isResourceNameProfileResult, type ResourceNameProfile } from "./resource-name-profile.js";

export const MAX_RESOURCE_TREE_ENTRIES = 8_192;
export const MAX_RESOURCE_TREE_DEPTH = 64;
export const MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES = 8 * 1024 * 1024;

declare const resourceTreeLocationBrand: unique symbol;
type ResourceTreeLocationBrand = { readonly [resourceTreeLocationBrand]: true };

declare const resourceTreeBudgetBrand: unique symbol;
type ResourceTreeBudgetBrand = { readonly [resourceTreeBudgetBrand]: true };

export type ResourceTreeRootLayout = Readonly<{
  entryIndex: null;
  parentIndex: null;
  depth: 0;
  exactName: "";
  exactNameByteLength: 0;
  relativePath: "";
  relativePathByteLength: 0;
}> &
  ResourceTreeLocationBrand;

export type ResourceTreeEntryLayout = Readonly<{
  /** Zero-based ordinal in the one-shot reservation chain. */
  entryIndex: number;
  /** The parent's zero-based ordinal, or null for a top-level entry. */
  parentIndex: number | null;
  depth: number;
  exactName: string;
  exactNameByteLength: number;
  relativePath: string;
  relativePathByteLength: number;
}> &
  ResourceTreeLocationBrand;

export type ResourceTreeLocation = ResourceTreeRootLayout | ResourceTreeEntryLayout;

export type ResourceTreeBudgetToken = Readonly<{
  entryCount: number;
  totalRelativePathBytes: number;
}> &
  ResourceTreeBudgetBrand;

export type ResourceTreeLayoutStart = Readonly<{
  root: ResourceTreeRootLayout;
  budget: ResourceTreeBudgetToken;
}>;

export type ResourceTreeReservationFailureReason =
  | "invalid_input"
  | "invalid_state"
  | "too_many_entries"
  | "too_deep"
  | "paths_too_large"
  | "duplicate_path";

export type ResourceTreeReservationSuccess = Readonly<{
  ok: true;
  entry: ResourceTreeEntryLayout;
  budget: ResourceTreeBudgetToken;
}>;

export type ResourceTreeReservationFailure = Readonly<{
  ok: false;
  reason: ResourceTreeReservationFailureReason;
}>;

export type ResourceTreeReservationResult =
  | ResourceTreeReservationSuccess
  | ResourceTreeReservationFailure;

export type ResourceTreeSiblingNameComparison =
  | Readonly<{ ok: true; order: -1 | 0 | 1 }>
  | Readonly<{ ok: false; reason: "invalid_input" }>;

type LayoutOwner = Readonly<{ exactPaths: Set<string> }>;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const freezeSnapshot = Object.freeze;
const setConstructorSnapshot = Set;
const setAddSnapshot = Set.prototype.add;
const setHasSnapshot = Set.prototype.has;
const weakMapGetSnapshot = WeakMap.prototype.get;
const weakMapSetSnapshot = WeakMap.prototype.set;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetDeleteSnapshot = WeakSet.prototype.delete;
const weakSetHasSnapshot = WeakSet.prototype.has;
const charCodeAtSnapshot = String.prototype.charCodeAt;

const budgetOwners = new WeakMap<object, LayoutOwner>();
const locationOwners = new WeakMap<object, LayoutOwner>();
const activeBudgets = new WeakSet<object>();

const INVALID_INPUT: Readonly<{ ok: false; reason: "invalid_input" }> = freezeSnapshot({
  ok: false,
  reason: "invalid_input",
});
const INVALID_STATE: ResourceTreeReservationFailure = freezeSnapshot({
  ok: false,
  reason: "invalid_state",
});
const TOO_MANY_ENTRIES: ResourceTreeReservationFailure = freezeSnapshot({
  ok: false,
  reason: "too_many_entries",
});
const TOO_DEEP: ResourceTreeReservationFailure = freezeSnapshot({
  ok: false,
  reason: "too_deep",
});
const PATHS_TOO_LARGE: ResourceTreeReservationFailure = freezeSnapshot({
  ok: false,
  reason: "paths_too_large",
});
const DUPLICATE_PATH: ResourceTreeReservationFailure = freezeSnapshot({
  ok: false,
  reason: "duplicate_path",
});

const INVALID_COMPARISON: ResourceTreeSiblingNameComparison = INVALID_INPUT;
const LESS: ResourceTreeSiblingNameComparison = freezeSnapshot({ ok: true, order: -1 });
const EQUAL: ResourceTreeSiblingNameComparison = freezeSnapshot({ ok: true, order: 0 });
const GREATER: ResourceTreeSiblingNameComparison = freezeSnapshot({ ok: true, order: 1 });

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function ownerOf(owners: WeakMap<object, LayoutOwner>, value: unknown): LayoutOwner | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  return applyIntrinsic<LayoutOwner | undefined>(weakMapGetSnapshot, owners, [value]);
}

function hasActiveBudget(value: object): boolean {
  return applyIntrinsic<boolean>(weakSetHasSnapshot, activeBudgets, [value]);
}

function registerBudget(
  budget: ResourceTreeBudgetToken,
  owner: LayoutOwner,
): ResourceTreeBudgetToken {
  applyIntrinsic<WeakMap<object, LayoutOwner>>(weakMapSetSnapshot, budgetOwners, [budget, owner]);
  applyIntrinsic<WeakSet<object>>(weakSetAddSnapshot, activeBudgets, [budget]);
  return budget;
}

function registerLocation<T extends ResourceTreeLocation>(location: T, owner: LayoutOwner): T {
  applyIntrinsic<WeakMap<object, LayoutOwner>>(weakMapSetSnapshot, locationOwners, [
    location,
    owner,
  ]);
  return location;
}

function consumeBudget(budget: ResourceTreeBudgetToken): void {
  applyIntrinsic<boolean>(weakSetDeleteSnapshot, activeBudgets, [budget]);
}

function hasExactPath(owner: LayoutOwner, relativePath: string): boolean {
  return applyIntrinsic<boolean>(setHasSnapshot, owner.exactPaths, [relativePath]);
}

function registerExactPath(owner: LayoutOwner, relativePath: string): void {
  applyIntrinsic<Set<string>>(setAddSnapshot, owner.exactPaths, [relativePath]);
}

function codeUnitAt(value: string, index: number): number {
  return applyIntrinsic<number>(charCodeAtSnapshot, value, [index]);
}

function compareUtf16(left: string, right: string): -1 | 0 | 1 {
  const limit = left.length < right.length ? left.length : right.length;
  for (let index = 0; index < limit; index += 1) {
    const leftCodeUnit = codeUnitAt(left, index);
    const rightCodeUnit = codeUnitAt(right, index);
    if (leftCodeUnit < rightCodeUnit) return -1;
    if (leftCodeUnit > rightCodeUnit) return 1;
  }
  if (left.length < right.length) return -1;
  if (left.length > right.length) return 1;
  return 0;
}

function successfulProfile(value: unknown): value is ResourceNameProfile {
  return isResourceNameProfileResult(value) && value.ok;
}

/**
 * Start one owner-bound resource-layout reservation chain.
 *
 * The root has depth zero and an empty logical path. It is a parent location, not an entry, so
 * its initial entry and aggregate-path budgets are both zero.
 */
export function createResourceTreeLayout(): ResourceTreeLayoutStart {
  const owner: LayoutOwner = freezeSnapshot({ exactPaths: new setConstructorSnapshot<string>() });
  const root = registerLocation(
    freezeSnapshot({
      entryIndex: null,
      parentIndex: null,
      depth: 0,
      exactName: "",
      exactNameByteLength: 0,
      relativePath: "",
      relativePathByteLength: 0,
    }) as ResourceTreeRootLayout,
    owner,
  );
  const budget = registerBudget(
    freezeSnapshot({
      entryCount: 0,
      totalRelativePathBytes: 0,
    }) as ResourceTreeBudgetToken,
    owner,
  );
  return freezeSnapshot({ root, budget });
}

/**
 * Reserve one child before any later kind or metadata filtering.
 *
 * A genuine current budget token has exactly one structurally valid attempt. The token is claimed
 * before budget checks, so every limit failure is terminal. A success alone creates its unique
 * successor token. Relative paths contain exact observed components joined with a literal `/`.
 */
export function reserveResourceTreeChild(
  budgetValue: unknown,
  parentValue: unknown,
  profileValue: unknown,
): ResourceTreeReservationResult {
  const budgetOwner = ownerOf(budgetOwners, budgetValue);
  if (budgetOwner === undefined || !hasActiveBudget(budgetValue as object)) {
    return INVALID_STATE;
  }

  const parentOwner = ownerOf(locationOwners, parentValue);
  if (parentOwner === undefined || parentOwner !== budgetOwner) {
    return INVALID_STATE;
  }
  if (!successfulProfile(profileValue)) {
    return INVALID_INPUT;
  }

  const budget = budgetValue as ResourceTreeBudgetToken;
  const parent = parentValue as ResourceTreeLocation;
  if (parent.entryIndex !== null && parent.entryIndex >= budget.entryCount) {
    return INVALID_STATE;
  }

  consumeBudget(budget);

  if (budget.entryCount >= MAX_RESOURCE_TREE_ENTRIES) {
    return TOO_MANY_ENTRIES;
  }
  const depth = parent.depth + 1;
  if (depth > MAX_RESOURCE_TREE_DEPTH) {
    return TOO_DEEP;
  }

  const separatorBytes = parent.depth === 0 ? 0 : 1;
  const relativePathByteLength =
    parent.relativePathByteLength + separatorBytes + profileValue.exactByteLength;
  const totalRelativePathBytes = budget.totalRelativePathBytes + relativePathByteLength;
  if (totalRelativePathBytes > MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES) {
    return PATHS_TOO_LARGE;
  }

  const entryIndex = budget.entryCount;
  const relativePath =
    parent.depth === 0 ? profileValue.exact : `${parent.relativePath}/${profileValue.exact}`;
  if (hasExactPath(budgetOwner, relativePath)) {
    return DUPLICATE_PATH;
  }
  registerExactPath(budgetOwner, relativePath);
  const entry = registerLocation(
    freezeSnapshot({
      entryIndex,
      parentIndex: parent.entryIndex,
      depth,
      exactName: profileValue.exact,
      exactNameByteLength: profileValue.exactByteLength,
      relativePath,
      relativePathByteLength,
    }) as ResourceTreeEntryLayout,
    budgetOwner,
  );
  const nextBudget = registerBudget(
    freezeSnapshot({
      entryCount: entryIndex + 1,
      totalRelativePathBytes,
    }) as ResourceTreeBudgetToken,
    budgetOwner,
  );
  return freezeSnapshot({ ok: true, entry, budget: nextBudget });
}

/**
 * Compare two genuine successful sibling-name profiles by exact UTF-16 code-unit order.
 *
 * This is not a comparator for flattened relative paths and does not define DFS order. A caller
 * obtains deterministic DFS order by visiting each independently sorted directory in preorder.
 */
export function compareResourceTreeSiblingNames(
  leftValue: unknown,
  rightValue: unknown,
): ResourceTreeSiblingNameComparison {
  if (!successfulProfile(leftValue) || !successfulProfile(rightValue)) {
    return INVALID_COMPARISON;
  }
  switch (compareUtf16(leftValue.exact, rightValue.exact)) {
    case -1:
      return LESS;
    case 0:
      return EQUAL;
    case 1:
      return GREATER;
  }
}
