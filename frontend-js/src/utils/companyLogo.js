export async function normalizeCompanyLogo(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('Company logo must be a PNG, JPG, or WebP image.');
    const url = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('The selected logo image could not be read.')); value.src = url; });
        const maxInput = 1800, ratio = Math.min(1, maxInput / Math.max(image.naturalWidth, image.naturalHeight)), source = document.createElement('canvas');
        source.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        source.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = source.getContext('2d', { willReadFrequently: true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, source.width, source.height);
        const pixels = context.getImageData(0, 0, source.width, source.height), data = pixels.data, corners = [[0, 0], [source.width - 1, 0], [0, source.height - 1], [source.width - 1, source.height - 1]];
        let cr = 0, cg = 0, cb = 0;
        for (const [x, y] of corners) {
            const i = (y * source.width + x) * 4;
            cr += data[i];
            cg += data[i + 1];
            cb += data[i + 2];
        }
        cr /= 4;
        cg /= 4;
        cb /= 4;
        const removableBackground = (cr + cg + cb) / 3 > 225 && Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 28;
        let left = source.width, top = source.height, right = -1, bottom = -1;
        for (let y = 0; y < source.height; y++)
            for (let x = 0; x < source.width; x++) {
                const i = (y * source.width + x) * 4;
                if (removableBackground) {
                    const distance = Math.max(Math.abs(data[i] - cr), Math.abs(data[i + 1] - cg), Math.abs(data[i + 2] - cb));
                    if (distance < 18)
                        data[i + 3] = 0;
                    else if (distance < 34)
                        data[i + 3] = Math.round(data[i + 3] * (distance - 18) / 16);
                }
                if (data[i + 3] > 18) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
        context.putImageData(pixels, 0, 0);
        if (right < left || bottom < top)
            throw new Error('The selected image does not contain a visible logo.');
        const output = document.createElement('canvas');
        output.width = 1200;
        output.height = 600;
        const out = output.getContext('2d');
        out.imageSmoothingEnabled = true;
        out.imageSmoothingQuality = 'high';
        const width = right - left + 1, height = bottom - top + 1, padding = 42, scale = Math.min((output.width - padding * 2) / width, (output.height - padding * 2) / height), drawWidth = width * scale, drawHeight = height * scale;
        out.clearRect(0, 0, output.width, output.height);
        out.drawImage(source, left, top, width, height, (output.width - drawWidth) / 2, (output.height - drawHeight) / 2, drawWidth, drawHeight);
        const blob = await new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('Unable to prepare the company logo.')), 'image/png', 1));
        return new File([blob], 'company-logo.png', { type: 'image/png', lastModified: Date.now() });
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
