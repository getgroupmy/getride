export type VehicleState = {
  id: string;
  type: string;
  latitude: number;
  longitude: number;
  heading: number;
};

type Listener = (v: VehicleState) => void;

const states = new Map<string, VehicleState>();
const listeners = new Map<string, Set<Listener>>();

export function setVehicles(next: VehicleState[]) {
  const nextIds = new Set(next.map((v) => v.id));
  for (const id of Array.from(states.keys())) {
    if (!nextIds.has(id)) states.delete(id);
  }
  for (const v of next) {
    states.set(v.id, v);
    const subs = listeners.get(v.id);
    if (subs) {
      subs.forEach((l) => l(v));
    }
  }
}

export function getVehicle(id: string): VehicleState | undefined {
  return states.get(id);
}

export function subscribeVehicle(id: string, listener: Listener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(id);
    if (s) {
      s.delete(listener);
      if (s.size === 0) listeners.delete(id);
    }
  };
}
