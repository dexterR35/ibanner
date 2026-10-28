let runtime;
async function loadCV() {
  if (!runtime)
    runtime = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/opencv.js';
      script.onload = async () => {
        try {
          resolve(await window.cv);
        } catch (error) {
          reject(error);
        }
      };
      script.onerror = () => {
        runtime = null;
        reject(new Error('Could not load the local OpenCV runtime. Run npm install.'));
      };
      document.head.appendChild(script);
    });
  return runtime;
}
/** Analysis runs on a small proxy; original upload bytes remain untouched. */
export async function analyzeImage(image) {
  const cv = await loadCV(),
    scale = Math.min(1, 512 / image.width),
    canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const src = cv.imread(canvas),
    gray = new cv.Mat(),
    edges = new cv.Mat(),
    mean = new cv.Mat(),
    std = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, edges, cv.CV_64F);
    cv.meanStdDev(edges, mean, std);
    return {
      width: image.width,
      height: image.height,
      luminance: Math.round(cv.mean(gray)[0]),
      edgeVariance: Math.round(std.data64F[0] ** 2),
      engine: 'OpenCV.js',
    };
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    mean.delete();
    std.delete();
  }
}

/**
 * Per-cell brightness and detail (0-100) of the rendered campaign photo. Detail is the mean
 * absolute Laplacian, so busy texture scores high and smooth sky or shadow scores low.
 */
export async function analyzePhotoGrid(image, longSide = 32) {
  const cv = await loadCV();
  const w = image.naturalWidth || image.width,
    h = image.naturalHeight || image.height;
  const cols = Math.max(4, Math.min(64, Math.round(w >= h ? longSide : (longSide * w) / h))),
    rows = Math.max(4, Math.min(64, Math.round(h > w ? longSide : (longSide * h) / w)));
  const scale = Math.min(1, 512 / Math.max(w, h)),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(cols, Math.round(w * scale));
  canvas.height = Math.max(rows, Math.round(h * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const src = cv.imread(canvas),
    gray = new cv.Mat(),
    edges = new cv.Mat(),
    magnitude = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, edges, cv.CV_16S, 3);
    cv.convertScaleAbs(edges, magnitude);
    const luminance = [],
      detail = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor((c * canvas.width) / cols),
          y0 = Math.floor((r * canvas.height) / rows);
        const rect = new cv.Rect(
          x0,
          y0,
          Math.max(1, Math.floor(((c + 1) * canvas.width) / cols) - x0),
          Math.max(1, Math.floor(((r + 1) * canvas.height) / rows) - y0),
        );
        const g = gray.roi(rect),
          m = magnitude.roi(rect);
        luminance.push(Math.round((cv.mean(g)[0] / 255) * 100));
        // 40 grey levels of mean edge response already reads as dense texture.
        detail.push(Math.min(100, Math.round((cv.mean(m)[0] / 40) * 100)));
        g.delete();
        m.delete();
      }
    return { width: w, height: h, cols, rows, luminance, detail };
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    magnitude.delete();
  }
}

/** Bounded pixel evidence for an editable, explicitly unapproved reference proposal. */
export async function analyzeReference(image) {
  const cv = await loadCV();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const src = cv.imread(canvas),
    gray = new cv.Mat(),
    binary = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  const textRects = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.threshold(gray, binary, 160, 255, cv.THRESH_BINARY);
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < Math.min(contours.size(), 5000); i++) {
      const contour = contours.get(i);
      try {
        const r = cv.boundingRect(contour);
        if (
          r.width >= 2 &&
          r.height >= 3 &&
          r.height < image.height * 0.18 &&
          r.width < image.width * 0.8
        )
          textRects.push(r);
      } finally {
        contour.delete();
      }
    }
  } finally {
    src.delete();
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
  const cell = Math.max(4, Math.ceil(Math.max(image.width, image.height) / 48)),
    cols = Math.ceil(image.width / cell),
    rows = Math.ceil(image.height / cell),
    values = [];
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let n = 0,
        sum = 0,
        squares = 0;
      for (let py = y * cell; py < Math.min(image.height, (y + 1) * cell); py += 2)
        for (let px = x * cell; px < Math.min(image.width, (x + 1) * cell); px += 2) {
          const i = (py * image.width + px) * 4,
            v = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          n++;
          sum += v;
          squares += v * v;
        }
      values.push(Math.min(1, Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)) / 70));
    }
  return {
    width: image.width,
    height: image.height,
    textRects,
    grid: { cell, cols, rows, values },
  };
}
