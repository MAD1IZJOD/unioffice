export class OrganizationSlug {
  private constructor(
    private readonly value: string,
  ) {}

  static create(value: string): OrganizationSlug {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!normalized) {
      throw new Error("Organization slug cannot be empty.");
    }

    if (normalized.length > 63) {
      throw new Error(
        "Organization slug cannot exceed 63 characters.",
      );
    }

    return new OrganizationSlug(normalized);
  }

  toString(): string {
    return this.value;
  }

  equals(other: OrganizationSlug): boolean {
    return this.value === other.value;
  }
}