import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type ClipRegionGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DraftPointer = {
  x: number;
  y: number;
};

type ClipRegionDrawerProps = {
  enabled: boolean;
  onDrawComplete: (geometry: ClipRegionGeometry) => void;
  children: ReactNode;
};

const MIN_CLIP_PERCENT = 2;

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function normalizeDraftRect(start: DraftPointer, end: DraftPointer): ClipRegionGeometry {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  let width = right - left;
  let height = bottom - top;

  if (width < MIN_CLIP_PERCENT) {
    width = MIN_CLIP_PERCENT;
  }

  if (height < MIN_CLIP_PERCENT) {
    height = MIN_CLIP_PERCENT;
  }

  const x = Math.min(100 - width, left);
  const y = Math.min(100 - height, top);

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}

export function ClipRegionDrawer({
  enabled,
  onDrawComplete,
  children,
}: ClipRegionDrawerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{
    start: DraftPointer;
    end: DraftPointer;
  } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const pointerToPercent = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }

    return {
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
  }, []);

  const finishDrawing = useCallback(
    (start: DraftPointer, end: DraftPointer) => {
      const geometry = normalizeDraftRect(start, end);

      if (geometry.width < MIN_CLIP_PERCENT || geometry.height < MIN_CLIP_PERCENT) {
        return;
      }

      onDrawComplete(geometry);
    },
    [onDrawComplete],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest(".clip-block, .clip-draw-preview")) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToPercent(event.clientX, event.clientY);

    setDraft({ start: point, end: point });
    setIsDrawing(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDrawing || !draft) {
      return;
    }

    setDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            end: pointerToPercent(event.clientX, event.clientY),
          }
        : null,
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDrawing || !draft) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const end = pointerToPercent(event.clientX, event.clientY);
    finishDrawing(draft.start, end);
    setDraft(null);
    setIsDrawing(false);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDraft(null);
    setIsDrawing(false);
  }

  const draftOverlay =
    draft && enabled
      ? normalizeDraftRect(draft.start, draft.end)
      : null;

  return (
    <div
      ref={stageRef}
      className={`clip-stage ${enabled ? "draw-mode" : ""}`}
    >
      {children}
      {enabled && (
        <div
          className="clip-draw-surface"
          role="presentation"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {draftOverlay && (
            <div
              className="clip-draw-preview"
              style={{
                left: `${draftOverlay.x}%`,
                top: `${draftOverlay.y}%`,
                width: `${draftOverlay.width}%`,
                height: `${draftOverlay.height}%`,
              }}
            />
          )}
          {!isDrawing && (
            <p className="clip-draw-hint">Drag to draw a clip rectangle</p>
          )}
        </div>
      )}
    </div>
  );
}
