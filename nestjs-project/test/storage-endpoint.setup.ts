// Jest runs inside Docker. Its HTTP client uses service DNS; browsers use the
// public endpoint configured on the separately running API container.
process.env.STORAGE_PUBLIC_ENDPOINT = `http://${process.env.STORAGE_ENDPOINT ?? 'minio'}:${process.env.STORAGE_PORT ?? '9000'}`;
