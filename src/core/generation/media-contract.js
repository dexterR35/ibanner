const ascii = (data, offset, length) => String.fromCharCode(...data.slice(offset, offset + length));
/** Pixel-edge transform from stored raster coordinates to EXIF-oriented source pixels. */
export function orientationTransform(orientation, width, height) {
  const matrices = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  return {
    matrix: matrices[orientation] || matrices[1],
    width: orientation >= 5 ? height : width,
    height: orientation >= 5 ? width : height,
    orientation,
  };
}
export function transformPoint(point, matrix) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}
/** Validate byte signatures and bounded header dimensions before asking the browser to decode. */
export function inspectImageHeader(buffer, mime) {
  const data = new Uint8Array(buffer),
    v = new DataView(buffer);
  let width,
    height,
    orientation = 1;
  if (mime === 'image/png') {
    if (
      data.length < 24 ||
      data[0] !== 137 ||
      ascii(data, 1, 3) !== 'PNG' ||
      ascii(data, 12, 4) !== 'IHDR'
    )
      throw new Error('Invalid PNG signature.');
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (mime === 'image/jpeg') {
    if (data.length < 4 || data[0] !== 255 || data[1] !== 216)
      throw new Error('Invalid JPEG signature.');
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 255) break;
      const marker = data[offset + 1];
      if (marker === 218 || marker === 217) break;
      if (marker === 255) {
        offset++;
        continue;
      }
      const size = v.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > data.length) throw new Error('Invalid JPEG segment.');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        height = v.getUint16(offset + 5);
        width = v.getUint16(offset + 7);
      }
      if (marker === 225 && ascii(data, offset + 4, 6) === 'Exif\0\0')
        try {
          const t = offset + 10,
            le = ascii(data, t, 2) === 'II',
            ifd = t + v.getUint32(t + 4, le),
            n = v.getUint16(ifd, le);
          for (let i = 0; i < Math.min(n, 256); i++) {
            const p = ifd + 2 + i * 12;
            if (v.getUint16(p, le) === 274) orientation = v.getUint16(p + 8, le);
          }
        } catch {
          throw new Error('Invalid JPEG orientation metadata.');
        }
      offset += 2 + size;
    }
  } else if (mime === 'image/webp') {
    if (data.length < 30 || ascii(data, 0, 4) !== 'RIFF' || ascii(data, 8, 4) !== 'WEBP')
      throw new Error('Invalid WebP signature.');
    const chunk = ascii(data, 12, 4);
    if (chunk === 'VP8X') {
      width = 1 + data[24] + data[25] * 256 + data[26] * 65536;
      height = 1 + data[27] + data[28] * 256 + data[29] * 65536;
    } else if (chunk === 'VP8 ' && data.length >= 30) {
      width = v.getUint16(26, true) & 16383;
      height = v.getUint16(28, true) & 16383;
    } else if (chunk === 'VP8L' && data[20] === 47) {
      const bits = v.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  } else if (mime === 'image/svg+xml') {
    const text = new TextDecoder().decode(data);
    if (
      !/<svg[\s>]/i.test(text) ||
      /<(?:script|foreignObject|iframe|object|embed)\b|\son\w+\s*=|(?:href|src)\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|webp);base64,)|<!ENTITY|<!DOCTYPE/i.test(
        text,
      )
    )
      throw new Error('SVG contains active or external content. Use a self-contained logo.');
    return { orientation: 1, coordinateSpace: 'vector-viewbox' };
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 40_000_000
  )
    throw new Error('Invalid image header or image exceeds 40 megapixels.');
  if (orientation < 1 || orientation > 8) orientation = 1;
  return {
    width,
    height,
    orientation,
    oriented: orientationTransform(orientation, width, height),
    coordinateSpace: 'normalized-oriented-source',
  };
}
