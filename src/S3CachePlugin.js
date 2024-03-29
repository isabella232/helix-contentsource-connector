/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { Response } from '@adobe/helix-fetch';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { encrypt, decrypt } from './encrypt.js';

/**
 * Cache plugin for MSAL
 * @class MemCachePlugin
 * @implements ICachePlugin
 */
export default class S3CachePlugin {
  constructor(context, { key, secret }) {
    const { log, env } = context;
    this.log = log;
    this.key = key;
    this.secret = secret;
    const opts = !env.AWS_S3_ACCESS_KEY_ID ? {} : {
      region: env.AWS_S3_REGION,
      credentials: {
        accessKeyId: env.AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY,
      },
    };
    this.s3 = new S3Client(opts);
  }

  async beforeCacheAccess(cacheContext) {
    const { log, secret, key } = this;
    try {
      log.info('s3: read token cache', key);
      const res = await this.s3.send(new GetObjectCommand({
        Bucket: 'helix-content-bus',
        Key: key,
      }));
      let data = await new Response(res.Body, {}).buffer();
      if (secret) {
        data = decrypt(secret, data).toString('utf-8');
      }
      cacheContext.tokenCache.deserialize(data);
      return true;
    } catch (e) {
      if (e.$metadata?.httpStatusCode === 404) {
        log.info('s3: unable to deserialize token cache: not found');
      } else {
        log.warn('s3: unable to deserialize token cache', e);
      }
    }
    return false;
  }

  async afterCacheAccess(cacheContext) {
    if (cacheContext.cacheHasChanged) {
      const { log, secret, key } = this;
      try {
        log.info('s3: write token cache', key);
        let data = cacheContext.tokenCache.serialize();
        if (secret) {
          data = encrypt(secret, Buffer.from(data, 'utf-8'));
        }
        await this.s3.send(new PutObjectCommand({
          Bucket: 'helix-content-bus',
          Key: key,
          Body: data,
          ContentType: secret ? 'application/octet-stream' : 'text/plain',
        }));
        return true;
      } catch (e) {
        log.warn('s3: unable to serialize token cache', e);
      }
    }
    return false;
  }
}
