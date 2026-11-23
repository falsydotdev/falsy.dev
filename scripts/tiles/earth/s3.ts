// AWS Signature Version 4 header signing, enough for range reads of Copernicus' S3 objects
// without an SDK. Copernicus rejects presigned URLs for valid keys (InvalidAccessKeyId), so sign headers.
import { createHash, createHmac } from 'node:crypto';

export interface SignOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  date?: Date;
  payloadHash?: string;
  extra?: Record<string, string>;
}

const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function signHeaders(
  url: string,
  { accessKeyId, secretAccessKey, region, date = new Date(), payloadHash = 'UNSIGNED-PAYLOAD', extra = {} }: SignOptions,
): Record<string, string> {
  const u = new URL(url);
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const day = stamp.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const signed: Record<string, string> = { host: u.host, ...extra, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  const lower = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const names = Object.keys(lower).sort();
  const path = u.pathname.split('/').map((s) => encode(decodeURIComponent(s))).join('/');
  const request = ['GET', path, '', names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(request).digest('hex')].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...sent } = signed;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}
