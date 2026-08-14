export interface Location {
  latitude: number;
  longitude: number;
  address: string;
}

export interface RideType {
  id: string;
  name: string;
  description: string;
  priceMultiplier: number;
  eta: number;
  icon: string;
  color: string;
  capacity: number;
}

export interface Ride {
  id: string;
  pickup: Location;
  destination: Location;
  rideType: RideType;
  price: number;
  distance: number;
  duration: number;
  status: "requested" | "accepted" | "arrived" | "in-progress" | "completed" | "cancelled";
  driver?: {
    name: string;
    rating: number;
    vehicle: string;
    plate: string;
    photo: string;
  };
}
