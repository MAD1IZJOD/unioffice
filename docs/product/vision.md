# UNIOFFICE

UNIOFFICE is not a chatbot for companies. It is an operating system in which
agents perform company work, and people stay in charge of what matters.

## What a person should understand within seconds

- **What the company is doing** - missions running and blocked (Command Center, Missions)
- **What the agents are doing** - who is working, waiting or available (Command Center, Agents)
- **What needs attention** - decisions, failures and stalls (the attention queue, Approvals)
- **What the system knows** - learned knowledge and why it exists (Company Brain)
- **What the system can do** - skills, tools and connected systems (Skills, Tools, Connections)
- **What requires a human** - every approval, with what it covers and who may decide (Approvals)

## Principles

1. **Real data only.** No invented metrics, no mock rows. An empty surface says so.
2. **The server decides.** The interface offers; authorization, governance and
   approvals are enforced in the API, every time.
3. **Grants, not wishes.** An agent can only do what its row holds. Skills,
   knowledge and external content can guide it but never widen it.
4. **Say why.** Every approval says why it exists and what each answer does;
   every piece of knowledge says where it came from and whether a person
   confirmed it.
5. **Restraint.** Dark, precise and information-dense. Blue means the system is
   working; red means a person is needed or something broke; nothing is
   coloured decoratively.

## Design system

All colour, type, space, radius, elevation, motion, focus, layering and
density come from the tokens in `apps/web/src/styles/system.css`, exposed to
Tailwind through `@theme` in `apps/web/src/index.css` (`text-ink-secondary`,
`border-line`, `bg-surface-2`). Pages use tokens, not raw values. Keyboard
focus is always visible and uniform; reduced motion is honoured globally.
