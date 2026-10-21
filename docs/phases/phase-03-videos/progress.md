# phase-03-videos — Progress

**Status:** completed
**SIs:** 6/6 completed

### SI-03.1 — Subir object storage e Redis
- **Status:** completed
- **Tests:** 7 passing
- **Observations:**
  - As imagens oficiais `minio/minio` e `quay.io/minio/minio` não puxam mais sem login (Docker Hub removeu o repositório; Quay responde 401). O object storage subiu com `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`, fork compatível com a API S3 e com `MINIO_ROOT_*`. O serviço no Compose continua `minio`, e o `mc` cria o bucket `videos`.
  - Não existe `nestjs-project/.env`. As chaves novas estão só no `.env.example`. O boot do Nest falha na validação até um `.env` local incluí-las.

### SI-03.2 — Criar a tabela videos
- **Status:** completed
- **Tests:** 5 passing
- **Observations:**
  - Criado `nestjs-project/.env` a partir do exemplo, com `MAIL_FROM` entre aspas. O arquivo está no `.gitignore`.
  - Os testes que sobem o `Channel` passaram a registrar `Video`, e `cleanAllTables` apaga `videos` antes de `channels`, porque o `@OneToMany` exige a metadata da entidade.
  - `migrations.integration-spec.ts` inclui `CreateVideos` e derruba as tabelas em ordem de FK, mais o enum de `verification_tokens`, para o reset não entrar em deadlock nem falhar no `CREATE TYPE`.

### SI-03.3 — Registrar e ler o rascunho
- **Status:** completed
- **Tests:** 20 passing
- **Observations:**
  - O e2e sobe o `AppModule` no `beforeAll` e só trunca o banco no `beforeEach`, no mesmo formato de `auth.e2e-spec.ts`. O spec pedia bootstrap no `beforeEach`.

### SI-03.4 — Abrir e retomar o upload
- **Status:** completed
- **Tests:** 19 passing
- **Observations:**
  - `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` ficaram em `^3.1123.0`. A árvore atual do registro pede `@aws-sdk/types@^3.975.0`, versão que ainda não existe, então a instalação usou o recorte publicado antes de 2026-09-01.

### SI-03.5 — Concluir o arquivo e processar
- **Status:** completed
- **Tests:** 25 passing
- **Observations:**
  - BullMQ 6 não traz o `ioredis`; ele foi instalado à parte para a fila e o worker subirem.
  - O fixture `test/fixtures/tiny.mp4` foi gerado com o ffmpeg da imagem do worker para o complete real.

### SI-03.6 — Entregar reprodução e download
- **Status:** completed
- **Tests:** 15 passing
- **Observations:** none
