import {
  skillRefOf,
  type OrganizationId,
  type Skill,
  type SkillCategory,
  type SkillField,
  type SkillId,
  type SkillRef,
  type WorkspaceId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SkillVersionRepository } from "./skill-version-repository.js";

interface VersionRow {
  organization_id: string;
  skill_ref: string;
  version: number;
  scope: Skill["scope"];
  workspace_id: string | null;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  instructions: string;
  inputs: SkillField[] | null;
  outputs: SkillField[] | null;
  required_tools: string[] | null;
  required_capabilities: string[] | null;
  approval: Skill["approval"];
  memory: Skill["memory"];
  recorded_at: string;
}

const COLUMNS =
  "organization_id,skill_ref,version,scope,workspace_id,slug,name,description,category,instructions,inputs,outputs,required_tools,required_capabilities,approval,memory,recorded_at";

/** Postgres unique violation: this version was recorded by someone else first. */
const ALREADY_RECORDED = "23505";

export class SupabaseSkillVersionRepository implements SkillVersionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async record(organizationId: OrganizationId, skill: Skill): Promise<Skill> {
    const ref = skillRefOf(skill);

    const { data, error } = await this.client
      .from("skill_versions")
      .insert({
        organization_id: organizationId,
        skill_ref: ref,
        version: skill.version,
        scope: skill.scope,
        workspace_id: skill.workspaceId ?? null,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        instructions: skill.instructions,
        inputs: skill.inputs,
        outputs: skill.outputs,
        required_tools: skill.requiredTools,
        required_capabilities: skill.requiredCapabilities,
        approval: skill.approval,
        memory: skill.memory,
      })
      .select(COLUMNS)
      .single();

    if (error) {
      // Two missions recording the same version at once: the stored one wins,
      // and it is the same content either way.
      if (error.code === ALREADY_RECORDED) {
        const existing = await this.find(organizationId, ref, skill.version);
        if (existing) return existing;
      }

      throw new Error(`Failed to record skill version: ${error.message}`);
    }

    return toSkill(data as VersionRow);
  }

  async find(organizationId: OrganizationId, ref: SkillRef, version: number): Promise<Skill | null> {
    const { data, error } = await this.client
      .from("skill_versions")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .eq("skill_ref", ref)
      .eq("version", version)
      .maybeSingle();

    if (error) throw new Error(`Failed to read skill version: ${error.message}`);
    return data ? toSkill(data as VersionRow) : null;
  }

  async history(organizationId: OrganizationId, ref: SkillRef): Promise<Skill[]> {
    const { data, error } = await this.client
      .from("skill_versions")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .eq("skill_ref", ref)
      .order("version", { ascending: false })
      .limit(100);

    if (error) throw new Error(`Failed to read skill history: ${error.message}`);
    return ((data ?? []) as VersionRow[]).map(toSkill);
  }
}

function toSkill(row: VersionRow): Skill {
  return {
    // A system skill keeps its system:<slug> identity; a stored one keeps its uuid.
    id: row.skill_ref as SkillId,
    scope: row.scope,
    organizationId: row.organization_id as OrganizationId,
    workspaceId: (row.workspace_id ?? undefined) as WorkspaceId | undefined,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    // A recorded version is a definition, not a live row: whether the skill is
    // still active is the live row's business, and is checked there.
    status: "active",
    instructions: row.instructions,
    inputs: row.inputs ?? [],
    outputs: row.outputs ?? [],
    requiredTools: row.required_tools ?? [],
    requiredCapabilities: row.required_capabilities ?? [],
    approval: row.approval,
    memory: row.memory,
    createdAt: new Date(row.recorded_at),
    updatedAt: new Date(row.recorded_at),
  };
}
