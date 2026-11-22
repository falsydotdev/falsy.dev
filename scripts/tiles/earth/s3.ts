// AWS Signature Version 4 query-string signing, enough for range reads of Copernicus' S3 objects
// without an SDK. A presigned URL lets geotiff.js issue its own range requests.
import { createHash, createHmac } from 'node:crypto';

export interface PresignOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  date?: Date;
  expiresS?: number;
}

const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function presignGet(url: string, { accessKeyId, secretAccessKey, region, date = new Date(), expiresS = 3600 }: PresignOptions): string {
  const u = new URL(url);
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const query: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(expiresS)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = query.map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const path = u.pathname.split('/').map((s) => encode(decodeURIComponent(s))).join('/');
  const request = ['GET', path, canonicalQuery, `host:${u.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(request).digest('hex')].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `${u.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
