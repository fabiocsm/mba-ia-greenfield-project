import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ENDPOINT: 'minio',
  STORAGE_BUCKET: 'videos',
  STORAGE_ACCESS_KEY: 'streamtube',
  STORAGE_SECRET_KEY: 'streamtube',
  REDIS_HOST: 'redis',
};

interface ValidatedEnv {
  SWAGGER_ENABLED: string;
  STORAGE_ENDPOINT: string;
  STORAGE_BUCKET: string;
  REDIS_HOST: string;
}

const validate = (
  env: Record<string, string>,
): { error?: { message: string }; value: ValidatedEnv } => {
  const result: { error?: { message: string }; value: ValidatedEnv } =
    envValidationSchema.validate(
      { ...requiredEnv, ...env },
      { allowUnknown: true, abortEarly: false },
    );
  return result;
};

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage and queue', () => {
  const validateWithout = (keys: string[]) => {
    const env: Record<string, string> = { ...requiredEnv };
    for (const key of keys) {
      delete env[key];
    }
    return envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });
  };

  it('should reject an environment without the storage keys', () => {
    const { error } = validateWithout([
      'STORAGE_ENDPOINT',
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
    ]);

    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ENDPOINT');
    expect(error!.message).toContain('STORAGE_BUCKET');
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
    expect(error!.message).toContain('STORAGE_SECRET_KEY');
  });

  it('should reject an environment without the Redis host', () => {
    const { error } = validateWithout(['REDIS_HOST']);

    expect(error).toBeDefined();
    expect(error!.message).toContain('REDIS_HOST');
  });

  it('should accept storage and Redis hosts that are Compose service names', () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('minio');
    expect(value.STORAGE_BUCKET).toBe('videos');
    expect(value.REDIS_HOST).toBe('redis');
  });
});
