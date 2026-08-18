// Upload audio (listening TOEFL): mp3/m4a/ogg/wav, maks 40MB.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/toefl');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.mp3', '.m4a', '.ogg', '.wav'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Hanya file audio (mp3/m4a/ogg/wav) yang diizinkan.'), false);
};

const uploadAudio = multer({ storage, fileFilter, limits: { fileSize: 40 * 1024 * 1024 } });

module.exports = uploadAudio;
