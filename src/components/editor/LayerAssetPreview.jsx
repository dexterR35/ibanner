import { useEffect, useRef } from 'react';

/** Show the bound source without a second image decode or a new asset binding. */
export default function LayerAssetPreview({ image, crop, label }) {
  const canvas = useRef(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 248, 88);
    if (!image) return;
    const [x, y, w, h] = crop || [
      0,
      0,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    ];
    const scale = Math.min(248 / w, 88 / h);
    ctx.drawImage(
      image,
      x,
      y,
      w,
      h,
      (248 - w * scale) / 2,
      (88 - h * scale) / 2,
      w * scale,
      h * scale,
    );
  }, [image, crop]);
  if (!image) return null;
  return (
    <figure className="layer-asset-preview">
      <canvas ref={canvas} width={248} height={88} role="img" aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
