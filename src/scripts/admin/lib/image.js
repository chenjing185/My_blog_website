/**
 * 手机拍照/相册图片的压缩。
 * 目标：把几 MB 的原图压到几百 KB，直接提交进仓库也不会太夸张。
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadWithImageElement(file));
  }
  return loadWithImageElement(file);
}

function loadWithImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这个图片格式浏览器打不开，换一张试试'));
    };
    img.src = url;
  });
}

function stripDataUrl(dataUrl) {
  return String(dataUrl).replace(/^data:[^;]+;base64,/, '');
}

/**
 * @param {File} file
 * @returns {Promise<{base64:string, ext:string, mime:string, width:number, height:number, bytes:number}>}
 */
export async function compressImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  // GIF 动图不压缩，直接原样上传
  if (file.type === 'image/gif') {
    const dataUrl = await readAsDataUrl(file);
    return { base64: stripDataUrl(dataUrl), ext: 'gif', mime: 'image/gif', width: 0, height: 0, bytes: file.size };
  }

  const bitmap = await loadBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片压缩');
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  if (typeof bitmap.close === 'function') bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('图片压缩失败，换一张试试');

  const dataUrl = await readAsDataUrl(blob);
  return {
    base64: stripDataUrl(dataUrl),
    ext: 'jpg',
    mime: 'image/jpeg',
    width: targetWidth,
    height: targetHeight,
    bytes: blob.size,
  };
}
