import { useEffect, useRef, useState, type ReactNode } from "react";

interface FitSize {
  width: number;
  height: number;
}

interface ZoomableImageSurfaceProps {
  src: string;
  alt: string;
  zoom: number;
  maxWidth?: number;
  className?: string;
  children?: ReactNode;
}

function computeFitSize(naturalWidth: number, naturalHeight: number, maxWidth: number): FitSize {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: maxWidth, height: maxWidth };
  }

  const scale = Math.min(maxWidth / naturalWidth, 1);
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

export function ZoomableImageSurface({
  src,
  alt,
  zoom,
  maxWidth = 960,
  className,
  children,
}: ZoomableImageSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [fitSize, setFitSize] = useState<FitSize | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [effectiveMaxWidth, setEffectiveMaxWidth] = useState(maxWidth);

  useEffect(() => {
    function updateMaxWidth() {
      setEffectiveMaxWidth(Math.min(maxWidth, window.innerWidth * 0.92));
    }

    updateMaxWidth();
    window.addEventListener("resize", updateMaxWidth);

    return () => {
      window.removeEventListener("resize", updateMaxWidth);
    };
  }, [maxWidth]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setFitSize(null);
    imageRef.current = null;

    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      if (!active) {
        return;
      }

      imageRef.current = image;
      setFitSize(computeFitSize(image.naturalWidth, image.naturalHeight, effectiveMaxWidth));
      setLoaded(true);
    };

    image.onerror = () => {
      if (!active) {
        return;
      }

      setLoaded(false);
      setFitSize(null);
      imageRef.current = null;
    };

    image.src = src;

    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [effectiveMaxWidth, src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;

    if (!canvas || !image || !fitSize || !loaded) {
      return;
    }

    const displayWidth = fitSize.width * zoom;
    const displayHeight = fitSize.height * zoom;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(displayWidth * devicePixelRatio));
    const pixelHeight = Math.max(1, Math.round(displayHeight * devicePixelRatio));

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, displayWidth, displayHeight);
    context.drawImage(image, 0, 0, displayWidth, displayHeight);
  }, [fitSize, loaded, zoom]);

  const displayWidth = fitSize ? fitSize.width * zoom : undefined;
  const displayHeight = fitSize ? fitSize.height * zoom : undefined;

  return (
    <div
      className={className ? `zoomable-image-surface ${className}` : "zoomable-image-surface"}
      style={{
        position: "relative",
        width: displayWidth,
        height: displayHeight,
      }}
    >
      <canvas ref={canvasRef} className="zoomable-image-canvas" role="img" aria-label={alt} />
      {children}
    </div>
  );
}
