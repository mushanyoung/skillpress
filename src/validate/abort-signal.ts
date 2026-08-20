import { types } from "node:util";

export type AbortSignalSample = "absent" | "active" | "aborted" | "invalid";

// Module initialization is the trust boundary for the prototype, sampler, and intrinsics below.
const applySnapshot = Reflect.apply;
const getPrototypeOfSnapshot = Object.getPrototypeOf;
const isProxySnapshot = types.isProxy;
const signalPrototypeSnapshot = AbortSignal.prototype;
const abortedGetterSnapshot = Object.getOwnPropertyDescriptor(
  signalPrototypeSnapshot,
  "aborted",
)?.get;

/**
 * Sample one optional current-realm, non-proxy cooperative cancellation hint.
 *
 * This narrows common structural forgeries but grants no authority: crafted compatible receivers
 * can control the sampled hint state.
 */
export function sampleAbortSignal(value: unknown): AbortSignalSample {
  if (value === undefined) return "absent";
  if (typeof value !== "object" || value === null) return "invalid";
  if (abortedGetterSnapshot === undefined) return "invalid";
  try {
    if (applySnapshot(isProxySnapshot, undefined, [value]) === true) return "invalid";
    if (applySnapshot(getPrototypeOfSnapshot, Object, [value]) !== signalPrototypeSnapshot) {
      return "invalid";
    }
    const aborted = applySnapshot(abortedGetterSnapshot, value, []);
    if (aborted === true) return "aborted";
    if (aborted === false) return "active";
    return "invalid";
  } catch {
    return "invalid";
  }
}
