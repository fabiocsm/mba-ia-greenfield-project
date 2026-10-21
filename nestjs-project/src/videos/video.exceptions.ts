import { DomainException } from '../common/exceptions/domain.exception';

export class VideoChannelForbiddenException extends DomainException {
  constructor() {
    super(
      'VIDEO_CHANNEL_FORBIDDEN',
      403,
      'Channel does not belong to the authenticated user',
    );
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoFileEmptyException extends DomainException {
  constructor() {
    super('VIDEO_FILE_EMPTY', 422, 'Video file is empty');
  }
}

export class VideoFileTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_FILE_TOO_LARGE', 422, 'Video file is larger than 10GB');
  }
}

export class VideoFileNotVideoException extends DomainException {
  constructor() {
    super('VIDEO_FILE_NOT_VIDEO', 422, 'File is not a video');
  }
}

export class VideoFileAlreadyStoredException extends DomainException {
  constructor() {
    super('VIDEO_FILE_ALREADY_STORED', 409, 'Video file is already stored');
  }
}

export class VideoUploadIncompleteException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_INCOMPLETE', 409, 'Video upload is incomplete');
  }
}

export class VideoUploadNotStartedException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_NOT_STARTED', 409, 'Video upload has not started');
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready');
  }
}

export class VideoFileNotStoredException extends DomainException {
  constructor() {
    super('VIDEO_FILE_NOT_STORED', 409, 'Video file is not stored');
  }
}

export class VideoProcessingNotScheduledException extends DomainException {
  constructor() {
    super(
      'VIDEO_PROCESSING_NOT_SCHEDULED',
      503,
      'Video processing was not scheduled',
    );
  }
}
