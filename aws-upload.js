const fs = require('fs');
const path = require('path');
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
require('dotenv').config(); 

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

// Cấu hình S3 client
const s3 = new S3Client({
  region: "ap-southeast-2", // Thay bằng region của bạn
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey
  }
});

const S3_BUCKET = 'xgame-assets';

// Hàm upload
async function uploadFileToS3(filePath, bucketName, keyName) {
  const fileStream = fs.createReadStream(filePath);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: S3_BUCKET,
      Key: keyName, // Tên file trong S3
      Body: fileStream
    }
  });

  upload.on("httpUploadProgress", (progress) => {
    console.log("Progress:", progress);
  });

  try {
    const result = await upload.done();
    console.log("✅ Upload thành công:", result);
  } catch (err) {
    console.error("❌ Upload thất bại:", err);
  }
}

// Gọi thử hàm
const filePath = path.join(__dirname, 'upload/bundle-download-test.bundle'); // File local
const bucketName = 'xgame-assets';             // Tên bucket
const keyName = 'test/bundle-download-test.bundle';                // Đường dẫn lưu trữ trong S3

// uploadFileToS3(filePath, bucketName, keyName);

module.exports = { uploadFileToS3 };
