import { useEffect, useRef } from 'react';
import { renderFrame } from '../../core/render.js';
export default function BannerPreview({
  blueprint,
  campaign,
  resources,
  time = 0,
  className = '',
}) {
  const ref = useRef();
  useEffect(() => {
    if (resources) renderFrame(ref.current, blueprint, campaign, resources, time);
  }, [blueprint, campaign, resources, time]);
  return (
    <canvas
      className={className}
      ref={ref}
      width={blueprint.width}
      height={blueprint.height}
      aria-label={`${blueprint.marketId} ${blueprint.width} by ${blueprint.height} banner preview`}
    />
  );
}
