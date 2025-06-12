const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { uploadFileToS3 } = require('./aws-upload');
const { uploadFileToR2 } = require('./cloudflare-R2');
require('dotenv').config(); 

const HISTORY_FILE = 'upload-history.json';

const app = express();
const upload = multer({ 
  dest: 'upload/',
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(express.static('.'));

// Đọc lịch sử từ file nếu có
let uploadHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    uploadHistory = JSON.parse(data);
  } catch (e) {
    uploadHistory = [];
  }
}

// Hàm ghi lịch sử ra file
function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(uploadHistory, null, 2), 'utf8');
}

async function uploadFolderToS3(localFolder, bucketName, s3Prefix) {
  const files = fs.readdirSync(localFolder, { withFileTypes: true });
  let uploadedFiles = [];
  for (const file of files) {
    if (!file.isFile()) continue; 
    const localPath = path.join(localFolder, file.name);
    const s3Key = path.posix.join(s3Prefix, file.name);
    await uploadFileToS3(localPath, bucketName, s3Key);
    await uploadFileToR2(localPath, bucketName, s3Key);
    uploadedFiles.push(s3Key);
  }
  return uploadedFiles;
}

app.post('/upload', upload.single('file'), async (req, res) => {
  const version = req.body.version || 'default';
  const extractPath = path.join('upload', version);
  const uploadRecord = {
    version,
    time: new Date().toISOString(),
    status: 'processing',
    message: '',
    files: []
  };
  uploadHistory.push(uploadRecord);

  try {
    if (fs.existsSync(extractPath)) {
      fs.rmSync(extractPath, { recursive: true, force: true });
    }
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(extractPath, true);
    const uploadedFiles = await uploadFolderToS3(extractPath, 'xgame-assets', version);

    uploadRecord.status = 'success';
    uploadRecord.message = 'Upload và giải nén thành công!';
    uploadRecord.files = uploadedFiles;
    saveHistory();
    res.send('Upload và giải nén thành công!');
  } catch (err) {
    uploadRecord.status = 'error';
    uploadRecord.message = err.message;
    saveHistory();
    res.status(500).send('Upload thất bại: ' + err.message);
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// API xem lịch sử upload
app.get('/upload-history', (req, res) => {
  res.json(uploadHistory);
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('File quá lớn!');
  }
  res.status(500).send('Lỗi server: ' + err.message);
});

app.listen(3000, () => console.log('Server running at http://localhost:3000'));