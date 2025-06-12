const AWS = require("aws-sdk");
const AdmZip = require("adm-zip");

const s3 = new AWS.S3();
const r2 = new AWS.S3({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true,
});

exports.handler = async (event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  const s3Obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  const zip = new AdmZip(s3Obj.Body);
  const zipEntries = zip.getEntries();

  const lastSlashIndex = key.lastIndexOf("/");
  const prefix =lastSlashIndex >= 0 ? key.substring(0, lastSlashIndex + 1) : "";

  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    const extractedKey = `${prefix}${entry.entryName}`;
    const fileBuffer = entry.getData();

    // 1. Upload vào Cloudflare R2
    await r2
      .putObject({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: extractedKey,
        Body: fileBuffer,
      })
      .promise();

    // 2. Upload vào lại S3 (nơi chứa file đã giải nén)
    await s3
      .putObject({
        Bucket: process.env.S3_OUTPUT_BUCKET, // <-- Bạn phải định nghĩa biến này
        Key: extractedKey,
        Body: fileBuffer,
      })
      .promise();
  }

  return { status: "done", files: zipEntries.length };
};
