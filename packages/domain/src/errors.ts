/** A request that would break a domain invariant. Messages are safe to show to operators. */
export class DomainError extends Error {
  override name = "DomainError";
}
