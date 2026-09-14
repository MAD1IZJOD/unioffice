// Loads the repository's .env before anything reads the environment.
import "./config.js";

import type { OrganizationId } from "@unioffice/core";

import {
  createSupabaseAdminClient,
  SupabaseEventRepository,
  SupabaseMembershipRepository,
  SupabaseOrganizationRepository,
} from "@unioffice/database";

import { claimOwnership, OwnerClaimError } from "./access/owner-claim.js";
import { SupabaseUserDirectory } from "./access/supabase-user-directory.js";
import { EventRecorder } from "./event-recorder.js";

const USAGE = "Usage: pnpm owner:claim <email> [--organization <slug>]";

/**
 * Makes the first owner of an organization:
 *
 *   pnpm owner:claim you@company.com
 *
 * Run it after signing in once, and the address becomes the owner straight
 * away; run it before, and the owner role waits for that address to sign in.
 * It refuses an organization that already has an owner.
 */
async function main(argv: string[]): Promise<void> {
  let email: string | undefined;
  let slug = "unioffice-development";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;

    if (argument === "--organization") {
      slug = argv[index + 1] ?? "";
      index += 1;
    } else if (argument !== "--") {
      email = argument;
    }
  }

  if (!email || !slug) throw new OwnerClaimError(USAGE);

  const supabase = createSupabaseAdminClient();
  const organization = await new SupabaseOrganizationRepository(supabase).findBySlug(slug);

  if (!organization) throw new OwnerClaimError(`No organization with the slug "${slug}".`);

  const { outcome } = await claimOwnership({
    members: new SupabaseMembershipRepository(supabase),
    users: new SupabaseUserDirectory(supabase),
    eventRecorder: new EventRecorder(new SupabaseEventRepository(supabase)),
    organizationId: organization.id as OrganizationId,
    email,
  });

  const messages = {
    already_owner: `${email} is already the owner of ${organization.name}.`,
    added: `${email} is now the owner of ${organization.name}.`,
    promoted: `${email} is now the owner of ${organization.name}.`,
    invited: `${email} will be the owner of ${organization.name} once they sign in with that address.`,
  };

  console.log(messages[outcome]);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof OwnerClaimError ? error.message : `Could not claim ownership: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
