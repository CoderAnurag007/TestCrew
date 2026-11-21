export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<{ key: string }>;
  get(key: string): Promise<Buffer>;
  /** Removes every object under a prefix such as `runs/<id>/`. Optional for test doubles. */
  deletePrefix?(prefix: string): Promise<void>;
}
