import {
  BeforeInsert,
  BeforeUpdate,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export type VideoStatus = 'draft' | 'processing' | 'ready' | 'error';

export function nullIfBlank(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return value.trim() === '' ? null : value;
}

@Entity('videos')
@Check(`"status" IN ('draft', 'processing', 'ready', 'error')`)
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', default: 'draft' })
  status: VideoStatus;

  @Column({ type: 'varchar', unique: true })
  public_url: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value == null ? null : Number(value)),
    },
  })
  declared_size_bytes: number | null;

  @Column({ type: 'varchar', nullable: true })
  declared_content_type: string | null;

  @Column({ type: 'varchar', nullable: true })
  multipart_upload_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  original_storage_key: string | null;

  @Column({ type: 'uuid', nullable: true })
  processing_claim: string | null;

  @Column({
    type: 'numeric',
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value == null ? null : Number(value)),
    },
  })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  technical_metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_storage_key: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeBlankText(): void {
    this.title = nullIfBlank(this.title);
    this.description = nullIfBlank(this.description);
  }
}
