export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<{ key: string }>;
  get(key: string): Promise<Buffer>;
}
