// Normalized inbound mail shape — Graph, IMAP, future EWS.

export type InboundMailMessage = {
  id: string;
  threadKey: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  bodyPreview: string;
  bodyText: string;
};
