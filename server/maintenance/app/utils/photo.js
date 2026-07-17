const sharp = require('sharp');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const DATA_DIR = require('./datadir');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Image upload ──────────────────────────────────────────────────────────────

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('يُسمح برفع الصور فقط.'));
    }
    cb(null, true);
  },
});

async function compressAndSave(buffer, prefix) {
  ensureUploadDir();
  const filename = `${prefix}_${Date.now()}.jpg`;
  const dest = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .rotate()
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toFile(dest);
  return filename;
}

async function compressToBuffer(buffer, prefix) {
  const filename = `${prefix}_${Date.now()}.jpg`;
  const data = await sharp(buffer)
    .rotate()
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
  try {
    ensureUploadDir();
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), data);
  } catch {}
  return { filename, data };
}

// ── Video upload + compression ────────────────────────────────────────────────

const memVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('يُسمح برفع الفيديوهات فقط.'));
    }
    cb(null, true);
  },
});

/**
 * Compress a video buffer to disk using ffmpeg.
 * Returns { filename } — no BYTEA (videos are too large for DB storage).
 */
async function compressVideoToDisk(buffer, prefix) {
  let ffmpeg, ffmpegPath;
  try {
    ffmpegPath = require('ffmpeg-static');
    ffmpeg     = require('fluent-ffmpeg');
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
  } catch (e) {
    throw new Error('ffmpeg غير متاح على الخادم: ' + e.message);
  }

  ensureUploadDir();
  const ts         = Date.now();
  const inputPath  = path.join(UPLOAD_DIR, `${prefix}_in_${ts}.tmp`);
  const outputName = `${prefix}_${ts}.mp4`;
  const outputPath = path.join(UPLOAD_DIR, outputName);

  fs.writeFileSync(inputPath, buffer);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-preset ultrafast',
          '-crf 28',
          '-vf scale=1280:-2',
          '-c:a aac',
          '-b:a 96k',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', (err) => reject(err))
        .run();
    });
    return { filename: outputName };
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
  }
}

module.exports = { memUpload, compressAndSave, compressToBuffer, memVideoUpload, compressVideoToDisk };
