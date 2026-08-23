import {
  createBrowserRouter,
} from "react-router-dom";

import App from "../App";
import Command from "../pages/Command";
import PlaceholderPage from "../pages/PlaceholderPage";

export const router =
  createBrowserRouter([
    {
      path: "/",
      element: <App />,
      children: [
        {
          index: true,
          element: <Command />,
        },
        {
          path: "command",
          element: <Command />,
        },
        {
          path: "work",
          element: (
            <PlaceholderPage
              title="Work"
              eyebrow="WORK MANAGEMENT"
              description="Track active work, execution plans, tasks, and outcomes."
            />
          ),
        },
        {
          path: "agents",
          element: (
            <PlaceholderPage
              title="Agents"
              eyebrow="AGENT OPERATIONS"
              description="Monitor agents, capabilities, execution state, and assignments."
            />
          ),
        },
        {
          path: "tools",
          element: (
            <PlaceholderPage
              title="Tools"
              eyebrow="TOOL REGISTRY"
              description="Manage the tools available to UNI-OFFICE agents."
            />
          ),
        },
        {
          path: "brain",
          element: (
            <PlaceholderPage
              title="Company Brain"
              eyebrow="COMPANY INTELLIGENCE"
              description="Company memory, knowledge, active threads, and strategic context."
            />
          ),
        },
        {
          path: "artifacts",
          element: (
            <PlaceholderPage
              title="Artifacts"
              eyebrow="OUTPUTS"
              description="Generated documents, reports, files, and other work products."
            />
          ),
        },
        {
          path: "approvals",
          element: (
            <PlaceholderPage
              title="Approvals"
              eyebrow="GOVERNANCE"
              description="Review actions that require human approval."
            />
          ),
        },
        {
          path: "activity",
          element: (
            <PlaceholderPage
              title="Activity"
              eyebrow="SYSTEM ACTIVITY"
              description="Observe execution events across the organization."
            />
          ),
        },
        {
          path: "organization",
          element: (
            <PlaceholderPage
              title="Organization"
              eyebrow="ORGANIZATION MAP"
              description="Visualize departments, agents, responsibilities, and relationships."
            />
          ),
        },
        {
          path: "governance",
          element: (
            <PlaceholderPage
              title="Governance"
              eyebrow="POLICIES & CONTROLS"
              description="Permissions, policies, approvals, and audit controls."
            />
          ),
        },
      ],
    },
  ]);