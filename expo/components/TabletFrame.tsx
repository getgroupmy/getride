import React from "react";
import { StyleSheet, View } from "react-native";
import { useResponsive } from "@/hooks/useResponsive";
import { useColors } from "@/hooks/useColors";

type Props = {
  children: React.ReactNode;
};

export function TabletFrame({ children }: Props) {
  const { isTablet, isPortrait, contentMaxWidth } = useResponsive();
  const colors = useColors();

  if (!isTablet || isPortrait) {
    return <>{children}</>;
  }

  return (
    <View
      style={[styles.outer, { backgroundColor: colors.background }]}
      testID="tablet-frame-outer"
    >
      <View
        style={[
          styles.inner,
          {
            maxWidth: contentMaxWidth,
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
        testID="tablet-frame-inner"
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    flex: 1,
    width: "100%",
    overflow: "hidden",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});

export default TabletFrame;
