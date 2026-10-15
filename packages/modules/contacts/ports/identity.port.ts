export interface ContactIdentityPort {
  mapIdentity(accountId: string, lid: string, pn: string): Promise<void>;
}
