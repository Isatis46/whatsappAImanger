export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
  }
}
export function ensure(
  condition: unknown,
  code: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DomainError(code, status);
}
export type Scope = {
  organizationId: string;
  userId: string;
  role: string;
  accountIds: string[];
};
export const adminRoles = ["SUPER_ADMIN", "ORG_ADMIN"];
export function isAdmin(scope: Scope): boolean {
  return adminRoles.includes(scope.role);
}
export function requireRole(scope: Scope, roles: readonly string[]): void {
  ensure(isAdmin(scope) || roles.includes(scope.role), "forbidden", 403);
}
export function requireAccount(scope: Scope, accountId: string): void {
  ensure(
    isAdmin(scope) || scope.accountIds.includes(accountId),
    "account_forbidden",
    403,
  );
}
export type EventEnvelope = {
  eventId: string;
  eventType: string;
  eventVersion: 1;
  organizationId: string;
  accountId: string | null;
  aggregateId: string;
  correlationId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};
