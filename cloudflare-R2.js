const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
require('dotenv').config(); 

const r2accessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const s3 = new AWS.S3({
  endpoint: "https://f83d3dc6d444c3c625dbb7043045ffbf.r2.cloudflarestorage.com",
  accessKeyId: r2accessKeyId,
  secretAccessKey: r2secretAccessKey,
  signatureVersion: "v4",
  region: "auto",
});
const S3_BUCKET = 'game-assets';

// Hàm upload 1 file lên Cloudflare R2
function uploadFileToR2(filePath, bucketName, keyName) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    s3.upload(
      {
        Bucket: S3_BUCKET,
        Key: keyName,
        Body: fileStream,
        ContentType: "application/octet-stream",
      },
      (err, data) => {
        if (err) {
          console.error(`Error uploading ${filePath}:`, err);
          reject(err);
        } else {
          console.log(`Uploaded ${filePath} to ${keyName}!`, data);
          resolve(data);
        }
      }
    );
  });
}

function test() {
  const uploadDir = "upload";

  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error("Error reading upload directory:", err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(uploadDir, file);
      uploadFileToR2(filePath, "game-assets", "test/" + file);
    });
  });
}
module.exports = { uploadFileToR2 };
