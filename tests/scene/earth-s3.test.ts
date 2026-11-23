import { describe, expect, it } from 'vitest';
import { signHeaders } from '../../scripts/tiles/earth/s3.ts';

describe('S3 header-signed GET', () => {
  it('matches the GET Object example in the AWS Signature Version 4 docs', () => {
    const headers = signHeaders('https://examplebucket.s3.amazonaws.com/test.txt', {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      date: new Date('2013-05-24T00:00:00Z'),
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      extra: { range: 'bytes=0-9' },
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('leaves the range unsigned by default, so one signature covers every range read of a file', () => {
    const opts = { accessKeyId: 'A', secretAccessKey: 'S', region: 'default', date: new Date('2026-11-23T00:00:00Z') };
    const headers = signHeaders('https://eodata.dataspace.copernicus.eu/eodata/x.tif', opts);
    expect(headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date,');
    expect(headers['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD');
  });
});
