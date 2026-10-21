const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export interface MailpitAddress {
  Address: string;
}

export interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: MailpitAddress[];
  From: MailpitAddress;
}

export interface MailpitMessageDetail extends MailpitMessageSummary {
  HTML: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export async function getMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = asRecord(await res.json());
  const messages = data?.messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(
    (item: unknown): item is MailpitMessageSummary =>
      typeof item === 'object' && item !== null && 'ID' in item,
  );
}

export async function getMailpitMessage(
  id: string,
): Promise<MailpitMessageDetail> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  const data: unknown = await res.json();
  return data as MailpitMessageDetail;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
