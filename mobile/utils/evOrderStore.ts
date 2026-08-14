/**
 * The TEKSI EV order this device has in flight.
 *
 * The wizard (`app/teksi-ev.tsx`) creates an `ev-orders` entry at the deposit
 * step and then keeps stepping through ownership, plate, financing, delivery.
 * Without a pointer to that entry, backing out of the screen — or a cold
 * launch — dropped the customer back at step 1 with no link to the order they
 * had already paid for. This keeps the pointer device-local (AsyncStorage),
 * the same way the ride side keeps its restore hints: nothing here needs a
 * migration and it survives the app being killed.
 *
 * Only the id is stored. The order itself is the `ev-orders` entry, which is
 * the single source of truth for everything the customer has answered.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const ACTIVE_EV_ORDER_KEY = "@ev_active_order_v1";

/** Remember which order this device is working through. */
export async function saveActiveEvOrderId(orderId: string): Promise<void> {
  try {
    const id = orderId.trim();
    if (!id) {
      await clearActiveEvOrderId();
      return;
    }
    await AsyncStorage.setItem(ACTIVE_EV_ORDER_KEY, id);
  } catch (e) {
    console.log("[evOrderStore] saveActiveEvOrderId failed", e);
  }
}

/** The in-flight order id, or "" when there is none. */
export async function loadActiveEvOrderId(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_EV_ORDER_KEY);
    return (raw ?? "").trim();
  } catch (e) {
    console.log("[evOrderStore] loadActiveEvOrderId failed", e);
    return "";
  }
}

/** Forget the in-flight order (handover accepted, or the row disappeared). */
export async function clearActiveEvOrderId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_EV_ORDER_KEY);
  } catch (e) {
    console.log("[evOrderStore] clearActiveEvOrderId failed", e);
  }
}
