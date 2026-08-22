export async function normalizeSignature(file) {
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)
        throw new Error('Signature must be an image no larger than 5 MB');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / bitmap.width, 500 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height), p = image.data;
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4, l = .2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2];
            const ink = Math.max(0, Math.min(1, (248 - l) / 55));
            p[i + 3] = Math.round(p[i + 3] * ink);
            if (p[i + 3] > 20) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    if (maxX < minX)
        throw new Error('No visible signature ink was detected');
    ctx.putImageData(image, 0, 0);
    const pad = 18, x = Math.max(0, minX - pad), y = Math.max(0, minY - pad), w = Math.min(canvas.width - x, maxX - minX + 1 + pad * 2), h = Math.min(canvas.height - y, maxY - minY + 1 + pad * 2);
    const out = document.createElement('canvas');
    const outputScale = Math.min(3, 1000 / w, 300 / h);
    out.width = Math.max(1, Math.round(w * outputScale));
    out.height = Math.max(1, Math.round(h * outputScale));
    const outputContext = out.getContext('2d');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.clearRect(0, 0, out.width, out.height);
    outputContext.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
    return await new Promise((resolve, reject) => out.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to process signature')), 'image/png'));
}
