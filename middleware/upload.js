import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// Existing relative upload paths remain compatible.
const uploadDir = 'uploads';

fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    // Do not use the client-provided filename for storage.
    cb(null, `${randomUUID()}${extension}`);
  }, 
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase(); 
  const expectedMimeType = allowedTypes[extension];

  if (
    !expectedMimeType ||
    file.mimetype.toLowerCase() !== expectedMimeType
  ) {
    const error = new Error(
      'Only PDF, JPG, JPEG and PNG documents are allowed.'
    );

    error.statusCode = 400;
    error.code = 'INVALID_FILE_TYPE';

    return cb(error);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
    fields: 30,
    fieldSize: 64 * 1024,
  },
});

export default upload;