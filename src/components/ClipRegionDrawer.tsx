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

type DraftPointer = { x: number; y: number };

type HandleType = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type ActiveBlockDragState = {
  pointerId: number;
  handle: HandleType;
  startPt: DraftPointer;
  startGeom: ClipRegionGeometry;
};

export type ActiveBlockOverlay = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDraft?: boolean;
};

type ClipRegionDrawerProps = {
  enabled: boolean;
  onDrawComplete: (geometry: ClipRegionGeometry) => void;
  activeBlock?: ActiveBlockOverlay | null;
  onActiveBlockChange?: (geometry: ClipRegionGeometry) => void;
  children: ReactNode;
};

const MIN_CLIP_PERCENT = 2;
const RESIZE_HANDLES: HandleType[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizeDraftRect(start: DraftPointer, end: DraftPointer): ClipRegionGeometry {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  let width = Math.max(right - left, MIN_CLIP_PERCENT);
  let height = Math.max(bottom - top, MIN_CLIP_PERCENT);
  const x = Math.min(100 - width, left);
  const y = Math.min(100 - height, top);
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}

/**
 * Apply a pointer delta to a block's geometry based on which resize handle is
 * being dragged. Returns a new geometry clamped to page bounds.
 */
function applyHandleDelta(
  start: ClipRegionGeometry,
  handle: HandleType,
  dx: number,
  dy: number,
): ClipRegionGeometry {
  let { x, y, width, height } = start;

  switch (handle) {
    case "move":
      x += dx;
      y += dy;
      break;
    case "n":
      y += dy;
      height -= dy;
      break;
    case "s":
      height += dy;
      break;
    case "e":
      width += dx;
      break;
    case "w":
      x += dx;
      width -= dx;
      break;
    case "nw":
      x += dx; y += dy;
      width -= dx; height -= dy;
      break;
    case "ne":
      y += dy;
      width += dx; height -= dy;
      break;
    case "se":
      width += dx; height += dy;
      break;
    case "sw":
      x += dx;
      width -= dx; height += dy;
      break;
  }

  // Enforce minimum size — lock the stationary edge when the moving edge crosses it
  if (width < MIN_CLIP_PERCENT) {
    if (handle === "w" || handle === "nw" || handle === "sw") {
      x = start.x + start.width - MIN_CLIP_PERCENT;
    }
    width = MIN_CLIP_PERCENT;
  }
  if (height < MIN_CLIP_PERCENT) {
    if (handle === "n" || handle === "nw" || handle === "ne") {
      y = start.y + start.height - MIN_CLIP_PERCENT;
    }
    height = MIN_CLIP_PERCENT;
  }

  // Clamp to page bounds
  x = Math.max(0, x);
  y = Math.max(0, y);
  if (x + width > 100) {
    if (handle === "move") x = 100 - width;
    else width = 100 - x;
  }
  if (y + height > 100) {
    if (handle === "move") y = 100 - height;
    else height = 100 - y;
  }

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}

function cursorForHandle(handle: HandleType): string {
  return handle === "move" ? "move" : `${handle}-resize`;
}

export function ClipRegionDrawer({
  enabled,
  onDrawComplete,
  activeBlock,
  onActiveBlockChange,
  children,
}: ClipRegionDrawerProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  // New-clip drawing state
  const [draft, setDraft] = useState<{ start: DraftPointer; end: DraftPointer } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Active block drag/resize state
  const activeBlockDragRef = useRef<ActiveBlockDragState | null>(null);
  const [liveActiveGeom, setLiveActiveGeom] = useState<ClipRegionGeometry | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);

  const pointerToPercent = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;

    // ── 1. Resize handle on the active block ─────────────────────────────────
    const handleEl = target.closest<HTMLElement>("[data-resize-handle]");
    if (handleEl && activeBlock && onActiveBlockChange) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const handle = handleEl.dataset.resizeHandle as HandleType;
      const startPt = pointerToPercent(event.clientX, event.clientY);
      activeBlockDragRef.current = {
        pointerId: event.pointerId,
        handle,
        startPt,
        startGeom: { x: activeBlock.x, y: activeBlock.y, width: activeBlock.width, height: activeBlock.height },
      };
      setIsDraggingBlock(true);
      document.body.style.cursor = cursorForHandle(handle);
      return;
    }

    // ── 2. Active block body → move ───────────────────────────────────────────
    if (target.closest(".clip-block--interactive") && activeBlock && onActiveBlockChange) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startPt = pointerToPercent(event.clientX, event.clientY);
      activeBlockDragRef.current = {
        pointerId: event.pointerId,
        handle: "move",
        startPt,
        startGeom: { x: activeBlock.x, y: activeBlock.y, width: activeBlock.width, height: activeBlock.height },
      };
      setIsDraggingBlock(true);
      document.body.style.cursor = "move";
      return;
    }

    // ── 3. Inactive block button clicked → let its onClick handle it ──────────
    if (target.closest(".clip-block")) return;

    // ── 4. Empty stage area → draw a new clip region ─────────────────────────
    if (!enabled) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToPercent(event.clientX, event.clientY);
    setDraft({ start: point, end: point });
    setIsDrawing(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    // Active block drag/resize in progress
    const blockDrag = activeBlockDragRef.current;
    if (blockDrag && blockDrag.pointerId === event.pointerId) {
      const pt = pointerToPercent(event.clientX, event.clientY);
      const dx = pt.x - blockDrag.startPt.x;
      const dy = pt.y - blockDrag.startPt.y;
      setLiveActiveGeom(applyHandleDelta(blockDrag.startGeom, blockDrag.handle, dx, dy));
      return;
    }

    // New clip drawing in progress
    if (!isDrawing || !draft) return;
    setDraft((curr) =>
      curr ? { ...curr, end: pointerToPercent(event.clientX, event.clientY) } : null,
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";

    // Commit active block drag/resize
    const blockDrag = activeBlockDragRef.current;
    if (blockDrag && blockDrag.pointerId === event.pointerId) {
      const pt = pointerToPercent(event.clientX, event.clientY);
      const dx = pt.x - blockDrag.startPt.x;
      const dy = pt.y - blockDrag.startPt.y;
      const finalGeom = applyHandleDelta(blockDrag.startGeom, blockDrag.handle, dx, dy);
      activeBlockDragRef.current = null;
      setLiveActiveGeom(null);
      setIsDraggingBlock(false);
      onActiveBlockChange?.(finalGeom);
      return;
    }

    // Commit new clip draw
    if (isDrawing && draft) {
      const end = pointerToPercent(event.clientX, event.clientY);
      const geometry = normalizeDraftRect(draft.start, end);
      if (geometry.width >= MIN_CLIP_PERCENT && geometry.height >= MIN_CLIP_PERCENT) {
        onDrawComplete(geometry);
      }
    }
    setDraft(null);
    setIsDrawing(false);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    activeBlockDragRef.current = null;
    setLiveActiveGeom(null);
    setIsDraggingBlock(false);
    setDraft(null);
    setIsDrawing(false);
  }

  const draftOverlay = draft && enabled ? normalizeDraftRect(draft.start, draft.end) : null;
  const displayedGeom = liveActiveGeom ?? (activeBlock ?? null);

  return (
    <div
      ref={stageRef}
      className={`clip-stage ${enabled ? "draw-mode" : ""} ${isDraggingBlock ? "block-dragging" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {children}

      {/* Active block overlay — draggable + resizable */}
      {activeBlock && displayedGeom && (
        <div
          className={`clip-block active clip-block--interactive ${activeBlock.isDraft ? "draft" : ""}`}
          style={{
            left: `${displayedGeom.x}%`,
            top: `${displayedGeom.y}%`,
            width: `${displayedGeom.width}%`,
            height: `${displayedGeom.height}%`,
          }}
        >
          <span className="clip-block-label">{activeBlock.label}</span>
          {RESIZE_HANDLES.map((h) => (
            <div
              key={h}
              className={`clip-resize-handle clip-resize-handle--${h}`}
              data-resize-handle={h}
            />
          ))}
        </div>
      )}

      {/* New-clip draw preview */}
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

      {/* Draw-mode hint */}
      {enabled && !isDrawing && !isDraggingBlock && (
        <p className="clip-draw-hint">
          {activeBlock ? "Drag block to move · handles to resize" : "Drag to draw a clip rectangle"}
        </p>
      )}
    </div>
  );
}
