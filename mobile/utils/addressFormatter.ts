export interface SmartAddress {
  primary: string;
  secondary: string;
}

export function formatSmartAddress(
  name: string,
  address: string
): SmartAddress {
  if (!name && !address) {
    return { primary: "Unknown Location", secondary: "" };
  }

  if (!address) {
    return { primary: name, secondary: "" };
  }

  const addressParts = address.split(",").map((part) => part.trim());
  
  if (addressParts.length === 1) {
    return { primary: name || addressParts[0], secondary: address };
  }

  if (addressParts.length === 2) {
    return {
      primary: name || addressParts[0],
      secondary: addressParts[1],
    };
  }

  return {
    primary: name || addressParts[0],
    secondary: addressParts.slice(0, 2).join(", "),
  };
}

export function formatDisplayAddress(name: string, address: string): string {
  if (!name && !address) {
    return "Unknown Location";
  }

  if (!address || !name) {
    return name || address;
  }

  const addressParts = address.split(",").map((part) => part.trim());
  
  if (addressParts.length <= 2) {
    return `${name}, ${address}`;
  }

  return `${name}, ${addressParts.slice(0, 2).join(", ")}`;
}
