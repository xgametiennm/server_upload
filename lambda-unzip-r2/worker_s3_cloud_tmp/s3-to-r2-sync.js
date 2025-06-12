const AWS = require('aws-sdk');
const https = require('https');

const s3 = new AWS.S3();

// R2 config – sử dụng S3 SDK với endpoint tùy chỉnh
const r2 = new AWS.S3({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  endpoint: process.env.R2_ENDPOINT,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true,
  httpOptions: {
    agent: new https.Agent({ keepAlive: true }),
  },
});

exports.handler = async (event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  console.log(`Received new file: s3://${bucket}/${key}`);

  try {
    // Bước 1: Lấy file từ S3
    const s3Object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    const fileData = s3Object.Body;
    const contentType = s3Object.ContentType || 'application/octet-stream';

    // Bước 2: Upload lên Cloudflare R2
    await r2.putObject({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: fileData,
      ContentType: contentType,
    }).promise();

    console.log(`Đã sync file lên R2: ${key}`);
    return { status: 'success', key };
  } catch (err) {
    console.error(`Sync thất bại: ${err.message}`);
    throw new Error('Sync to R2 failed');
  }
};
