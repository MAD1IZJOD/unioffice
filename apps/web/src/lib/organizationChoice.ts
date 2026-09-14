const CHOSEN_ORGANIZATION = "unioffice.organization";

/**
 * Which of their organizations this person last chose to look at. Only a
 * preference: the API decides whether they belong there.
 */
export function chosenOrganization(): string | undefined {
  try {
    return window.localStorage.getItem(CHOSEN_ORGANIZATION) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberOrganization(id: string | undefined): void {
  try {
    if (id) window.localStorage.setItem(CHOSEN_ORGANIZATION, id);
    else window.localStorage.removeItem(CHOSEN_ORGANIZATION);
  } catch {
    // Remembering the choice is a convenience; without storage the oldest
    // membership is used.
  }
}

/** Switches the organization being shown, then re-reads everything for it. */
export function chooseOrganization(id: string): void {
  rememberOrganization(id);
  window.location.assign("/command");
}
