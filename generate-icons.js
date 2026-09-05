const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, r, g, b) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    function createChunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeAndData = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
        return Buffer.concat([len, typeAndData, crc]);
    }

    function crc32(buf) {
        let crc = -1;
        for (let i = 0; i < buf.length; i++) {
            crc ^= buf[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
            }
        }
        return (crc ^ -1) >>> 0;
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // Bit depth
    ihdr[9] = 2; // Truecolor (RGB)
    ihdr[10] = 0; // Compression
    ihdr[11] = 0; // Filter
    ihdr[12] = 0; // Interlace

    // Raw image data: height lines, each starting with filter byte 0, then RGB
    const rowLen = 1 + width * 3;
    const rawData = Buffer.alloc(height * rowLen);
    for (let y = 0; y < height; y++) {
        const offset = y * rowLen;
        rawData[offset] = 0; // Filter None
        for (let x = 0; x < width; x++) {
            const pixelOffset = offset + 1 + x * 3;
            rawData[pixelOffset] = r;
            rawData[pixelOffset + 1] = g;
            rawData[pixelOffset + 2] = b;
        }
    }

    const idatData = zlib.deflateSync(rawData);
    const idat = createChunk('IDAT', idatData);
    const iend = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, createChunk('IHDR', ihdr), idat, iend]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'icon-16.png'), createPNG(16, 16, 79, 70, 229));
fs.writeFileSync(path.join(iconsDir, 'icon-48.png'), createPNG(48, 48, 79, 70, 229));
fs.writeFileSync(path.join(iconsDir, 'icon-128.png'), createPNG(128, 128, 79, 70, 229));

console.log('✅ Generated 16x16, 48x48, and 128x128 PNG icons successfully.');
