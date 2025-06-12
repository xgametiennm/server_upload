const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const AdmZip = require('adm-zip');

exports.handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const zipKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));

  // Tải file ZIP từ S3
  const zipData = await s3.getObject({ Bucket: bucket, Key: zipKey }).promise();
  const zip = new AdmZip(zipData.Body);
  const zipEntries = zip.getEntries();

  const uploadPromises = zipEntries
    .filter(e => !e.isDirectory)
    .map(entry => {
      const params = {
        Bucket: bucket,
        Key: zipKey.replace(/\.zip$/, '') + '/' + entry.entryName, // giải nén vào cùng prefix
        Body: entry.getData(),
        ContentType: getMimeType(entry.entryName)
      };
      return s3.upload(params).promise();
    });

  await Promise.all(uploadPromises);

  return { status: 'done', files: uploadPromises.length };
};

// Tùy chọn: Hàm xác định content-type (đơn giản)
function getMimeType(filename) {
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
