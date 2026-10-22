import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1792608510161 implements MigrationInterface {
  name = 'CreateVideos1792608510161';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'draft', "public_url" character varying NOT NULL, "title" text, "description" text, "declared_size_bytes" bigint, "declared_content_type" character varying, "multipart_upload_id" character varying, "original_storage_key" character varying, "processing_claim" uuid, "duration_seconds" numeric, "technical_metadata" jsonb, "thumbnail_storage_key" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3aee6a43961e0b0d42db709abc1" UNIQUE ("public_url"), CONSTRAINT "CHK_bbf177fa9fdf3e5b0825c00878" CHECK ("status" IN ('draft', 'processing', 'ready', 'error')), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
