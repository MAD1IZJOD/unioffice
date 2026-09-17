import type {
  OrganizationId,
  Skill,
  SkillCategory,
  SkillField,
  SkillId,
  UserId,
  WorkspaceId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SkillConflictError, type SkillRepository } from "./skill-repository.js";

interface SkillRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: number;
  status: Skill["status"];
  instructions: string;
  inputs: SkillField[] | null;
  outputs: SkillField[] | null;
  required_tools: string[] | null;
  required_capabilities: string[] | null;
  approval: Skill["approval"];
  memory: Skill["memory"];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id,organization_id,workspace_id,slug,name,description,category,version,status,instructions,inputs,outputs,required_tools,required_capabilities,approval,memory,created_by,updated_by,created_at,updated_at";

export class SupabaseSkillRepository implements SkillRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(organizationId: OrganizationId): Promise<Skill[]> {
    const { data, error } = await this.client
      .from("skills")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(`Failed to list skills: ${error.message}`);
    return ((data ?? []) as SkillRow[]).map(toSkill);
  }

  async find(organizationId: OrganizationId, skillId: SkillId): Promise<Skill | null> {
    const { data, error } = await this.client
      .from("skills")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", skillId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find skill: ${error.message}`);
    return data ? toSkill(data as SkillRow) : null;
  }

  async create(skill: Skill): Promise<Skill> {
    const { data, error } = await this.client
      .from("skills")
      .insert({
        id: skill.id,
        organization_id: skill.organizationId,
        workspace_id: skill.workspaceId ?? null,
        slug: skill.slug,
        ...content(skill),
        created_by: skill.createdBy ?? null,
        created_at: skill.createdAt.toISOString(),
      })
      .select(COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") throw new SkillConflictError();
      throw new Error(`Failed to create skill: ${error.message}`);
    }

    return toSkill(data as SkillRow);
  }

  async update(skill: Skill, expectedVersion: number): Promise<Skill | null> {
    // The version in the filter makes this a compare-and-swap: two people
    // saving the same skill cannot silently overwrite each other.
    const { data, error } = await this.client
      .from("skills")
      .update(content(skill))
      .eq("organization_id", skill.organizationId)
      .eq("id", skill.id)
      .eq("version", expectedVersion)
      .select(COLUMNS);

    if (error) {
      if (error.code === "23505") throw new SkillConflictError();
      throw new Error(`Failed to update skill: ${error.message}`);
    }

    const row = ((data ?? []) as SkillRow[])[0];
    return row ? toSkill(row) : null;
  }
}

function content(skill: Skill) {
  return {
    name: skill.name,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    status: skill.status,
    instructions: skill.instructions,
    inputs: skill.inputs,
    outputs: skill.outputs,
    required_tools: skill.requiredTools,
    required_capabilities: skill.requiredCapabilities,
    approval: skill.approval,
    memory: skill.memory,
    updated_by: skill.updatedBy ?? null,
    updated_at: skill.updatedAt.toISOString(),
  };
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id as SkillId,
    scope: row.workspace_id ? "workspace" : "organization",
    organizationId: row.organization_id as OrganizationId,
    workspaceId: (row.workspace_id ?? undefined) as WorkspaceId | undefined,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    status: row.status,
    instructions: row.instructions,
    inputs: row.inputs ?? [],
    outputs: row.outputs ?? [],
    requiredTools: row.required_tools ?? [],
    requiredCapabilities: row.required_capabilities ?? [],
    approval: row.approval,
    memory: row.memory,
    createdBy: (row.created_by ?? undefined) as UserId | undefined,
    updatedBy: (row.updated_by ?? undefined) as UserId | undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
