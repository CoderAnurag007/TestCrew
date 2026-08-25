import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { LocalFileStorage } from './local-storage.js';
import type { ObjectStorage, PutObjectInput } from './types.js';

export type { ObjectStorage, PutObjectInput } from './types.js';
export { LocalFileStorage } from './local-storage.js';
export { BugDetector, ErrorDetector, FindingClassifier } from './detectors.js';
export { SeverityClassifier, type DetectionSignal } from './severity.js';
export { DuplicateDetector, findingSignature, normalizeTitle, tokenSimilarity } from './duplicates.js';
export { ConfidenceCalculator } from './confidence.js';
export { AccessibilityAnalyzer } from './accessibility.js';
export { VisualAnalyzer, VIEWPORT_PROFILES } from './visual.js';
export { calculateQualityScore, coverageFrom } from './scoring.js';
export { ReportGenerator, type ReportPayload } from './report.js';

export class S3CompatibleStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly options: {
      endpoint?: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    },
  ) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Object not found: ${key}`);
    }
    return Buffer.from(bytes);
  }
}

export function createObjectStorage(options: {
  artifactDir: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}): ObjectStorage {
  if (options.bucket && options.accessKeyId && options.secretAccessKey) {
    return new S3CompatibleStorage({
      bucket: options.bucket,
      region: options.region ?? 'us-east-1',
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      forcePathStyle: options.forcePathStyle,
    });
  }
  return new LocalFileStorage(options.artifactDir);
}
