'use client';

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

interface TeachingSidePanelProps {
  title: string;
  icon: ReactNode;
  children?: ReactNode;
}

interface ScrollThumbMetrics {
  height: number;
  offset: number;
}

export default function TeachingSidePanel({
  title,
  icon,
  children,
}: TeachingSidePanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);
  const [thumbMetrics, setThumbMetrics] = useState<ScrollThumbMetrics>({
    height: 48,
    offset: 0,
  });

  const updateThumb = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;

    const trackHeight = element.clientHeight;
    const scrollRange = Math.max(element.scrollHeight - trackHeight, 0);
    const calculatedHeight =
      element.scrollHeight > 0
        ? (trackHeight / element.scrollHeight) * trackHeight
        : trackHeight;
    const height = Math.min(trackHeight, Math.max(42, calculatedHeight));
    const offset =
      scrollRange > 0
        ? (element.scrollTop / scrollRange) * (trackHeight - height)
        : 0;

    setThumbMetrics({ height, offset });
  }, []);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const frame = window.requestAnimationFrame(updateThumb);
    const resizeObserver = new ResizeObserver(updateThumb);
    const mutationObserver = new MutationObserver(updateThumb);
    resizeObserver.observe(element);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateThumb]);

  const scrollToRailPosition = (clientY: number) => {
    const content = contentRef.current;
    const rail = railRef.current;
    if (!content || !rail) return;

    const railRect = rail.getBoundingClientRect();
    const movableTrack = Math.max(railRect.height - thumbMetrics.height, 0);
    const scrollRange = Math.max(
      content.scrollHeight - content.clientHeight,
      0,
    );
    const desiredOffset = Math.min(
      movableTrack,
      Math.max(0, clientY - railRect.top - thumbMetrics.height / 2),
    );

    content.scrollTop =
      movableTrack > 0 ? (desiredOffset / movableTrack) * scrollRange : 0;
    updateThumb();
  };

  const handleRailPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    scrollToRailPosition(event.clientY);
  };

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    if (!content) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: content.scrollTop,
    };
  };

  const handleThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    const rail = railRef.current;
    const dragState = dragStateRef.current;
    if (!content || !rail || dragState?.pointerId !== event.pointerId) return;

    const movableTrack = Math.max(
      rail.clientHeight - thumbMetrics.height,
      0,
    );
    const scrollRange = Math.max(
      content.scrollHeight - content.clientHeight,
      0,
    );
    const scrollPerPixel = movableTrack > 0 ? scrollRange / movableTrack : 0;
    content.scrollTop =
      dragState.startScrollTop +
      (event.clientY - dragState.startY) * scrollPerPixel;
    updateThumb();
  };

  const stopThumbDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleRailWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    if (!content) return;
    event.preventDefault();
    content.scrollTop += event.deltaY;
    updateThumb();
  };

  return (
    <Paper className="teaching-side-card" elevation={0}>
      <Stack direction="row" alignItems="center" gap={1}>
        {icon}
        <Typography fontWeight={850}>{title}</Typography>
      </Stack>

      <Box
        ref={contentRef}
        className="teaching-side-content"
        role="region"
        aria-label={`${title}内容`}
        tabIndex={0}
        onScroll={updateThumb}
      >
        {children}
      </Box>

      <Box
        ref={railRef}
        className="teaching-scroll-rail"
        aria-hidden="true"
        onPointerDown={handleRailPointerDown}
        onWheel={handleRailWheel}
      >
        <Box
          className="teaching-scroll-thumb"
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={stopThumbDrag}
          onPointerCancel={stopThumbDrag}
          sx={{
            height: `${thumbMetrics.height}px`,
            transform: `translateY(${thumbMetrics.offset}px)`,
          }}
        />
      </Box>
    </Paper>
  );
}
