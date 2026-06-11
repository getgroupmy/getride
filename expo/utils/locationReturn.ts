export type PendingLocationReturn = {
  pickup: string;
  pickupLat: string;
  pickupLng: string;
  destinations: Array<{ address: string; lat: number; lng: number }>;
  fromOfferFare: boolean;
};

let pending: PendingLocationReturn | null = null;

export function setPendingLocationReturn(data: PendingLocationReturn) {
  pending = data;
}

export function consumePendingLocationReturn(): PendingLocationReturn | null {
  const data = pending;
  pending = null;
  return data;
}
