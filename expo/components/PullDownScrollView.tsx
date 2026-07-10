import React, { forwardRef, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";

/** Drag resistance applied to the pull distance (finger moves 2px → content moves 1px). */
const PULL_RESISTANCE = 0.5;
/** Max distance the content can be pulled down. */
const MAX_PULL = 120;
/** Pull distance (after resistance) required to trigger a refresh. */
const TRIGGER_DISTANCE = 58;
/** Offset the content holds at while refreshing. */
const HOLD_OFFSET = 52;

export type PullDownScrollViewProps = ScrollViewProps & {
  /** Called when the user pulls down far enough. Refresh ends when the promise resolves. */
  onPullRefresh: () => Promise<void> | void;
  /** Colour of the pull-to-refresh spinner. */
  spinnerColor?: string;
  children?: React.ReactNode;
};

/**
 * ScrollView with strictly one-directional over-scroll: native bouncing is
 * fully disabled (pushing up past the bottom does nothing at all — no
 * movement, no kickback), and pull-to-refresh is reimplemented as a custom
 * downward-only pan gesture that only engages at the very top of the content.
 */
const PullDownScrollView = forwardRef<ScrollView, PullDownScrollViewProps>(
  function PullDownScrollView(
    { onPullRefresh, spinnerColor = "#FFFFFF", children, onScroll, ...scrollProps },
    ref
  ) {
    const innerRef = useRef<ScrollView | null>(null);
    const translateY = useRef(new Animated.Value(0)).current;
    const atTopRef = useRef<boolean>(true);
    const refreshingRef = useRef<boolean>(false);
    const onPullRefreshRef = useRef(onPullRefresh);
    onPullRefreshRef.current = onPullRefresh;
    const [refreshing, setRefreshing] = useState<boolean>(false);

    const setRefs = (node: ScrollView | null) => {
      innerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      atTopRef.current = e.nativeEvent.contentOffset.y <= 0;
      onScroll?.(e);
    };

    const panResponder = useMemo(() => {
      const springBack = () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
        }).start();
      };

      const startRefresh = () => {
        refreshingRef.current = true;
        setRefreshing(true);
        Animated.timing(translateY, {
          toValue: HOLD_OFFSET,
          duration: 150,
          useNativeDriver: true,
        }).start();
        Promise.resolve(onPullRefreshRef.current()).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          Animated.timing(translateY, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start();
        });
      };

      return PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        // Steal the gesture only for a mostly-vertical downward drag that
        // starts while the list is at the very top. Everything else (taps,
        // upward drags, mid-list scrolling) goes to the ScrollView untouched.
        onMoveShouldSetPanResponderCapture: (_evt, g) =>
          !refreshingRef.current &&
          atTopRef.current &&
          g.dy > 8 &&
          Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_evt, g) => {
          const pulled = Math.min(Math.max(0, g.dy) * PULL_RESISTANCE, MAX_PULL);
          translateY.setValue(pulled);
        },
        onPanResponderRelease: (_evt, g) => {
          const pulled = Math.min(Math.max(0, g.dy) * PULL_RESISTANCE, MAX_PULL);
          if (pulled >= TRIGGER_DISTANCE) {
            startRefresh();
          } else {
            springBack();
          }
        },
        onPanResponderTerminate: () => {
          if (!refreshingRef.current) springBack();
        },
        onPanResponderTerminationRequest: () => false,
      });
    }, [translateY]);

    const spinnerOpacity = translateY.interpolate({
      inputRange: [0, TRIGGER_DISTANCE],
      outputRange: [0, 1],
      extrapolate: "clamp",
    });

    return (
      <View style={styles.fill} {...panResponder.panHandlers}>
        <Animated.View
          style={[styles.spinnerWrap, { opacity: spinnerOpacity }]}
          pointerEvents="none"
        >
          <ActivityIndicator color={spinnerColor} animating={refreshing || true} />
        </Animated.View>
        <Animated.View style={[styles.fill, { transform: [{ translateY }] }]}>
          <ScrollView
            {...scrollProps}
            ref={setRefs}
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  spinnerWrap: {
    position: "absolute" as const,
    top: 14,
    left: 0,
    right: 0,
    alignItems: "center",
  },
});

export default PullDownScrollView;
