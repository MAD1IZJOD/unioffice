import type {
  Organization,
  OrganizationId,
} from "@unioffice/core";

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  OrganizationRepository,
} from "./organization-repository.js";

export class SupabaseOrganizationRepository
  implements OrganizationRepository
{
  constructor(
    private readonly client: SupabaseClient,
  ) {}

  async create(
    organization: Organization,
  ): Promise<Organization> {
    const { data, error } =
      await this.client
        .from("organizations")
        .insert({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          created_at:
            organization.createdAt.toISOString(),
          updated_at:
            organization.updatedAt.toISOString(),
          metadata:
            organization.metadata,
        })
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to create organization: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async findById(
    id: OrganizationId,
  ): Promise<Organization | null> {
    const { data, error } =
      await this.client
        .from("organizations")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find organization: ${error.message}`,
      );
    }

    return data
      ? this.mapRow(data)
      : null;
  }

  async findBySlug(
    slug: string,
  ): Promise<Organization | null> {
    const { data, error } =
      await this.client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find organization by slug: ${error.message}`,
      );
    }

    return data
      ? this.mapRow(data)
      : null;
  }

  async update(
    organization: Organization,
  ): Promise<Organization> {
    const { data, error } =
      await this.client
        .from("organizations")
        .update({
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          updated_at:
            organization.updatedAt.toISOString(),
          metadata:
            organization.metadata,
        })
        .eq("id", organization.id)
        .select()
        .single();

    if (error) {
      throw new Error(
        `Failed to update organization: ${error.message}`,
      );
    }

    return this.mapRow(data);
  }

  async delete(
    id: OrganizationId,
  ): Promise<void> {
    const { error } =
      await this.client
        .from("organizations")
        .delete()
        .eq("id", id);

    if (error) {
      throw new Error(
        `Failed to delete organization: ${error.message}`,
      );
    }
  }

  private mapRow(
    row: any,
  ): Organization {
    return {
      id: row.id as OrganizationId,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt:
        new Date(row.created_at),
      updatedAt:
        new Date(row.updated_at),
      metadata:
        row.metadata ?? {},
    };
  }
}