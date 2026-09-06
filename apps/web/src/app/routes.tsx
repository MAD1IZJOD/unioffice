import { createBrowserRouter } from "react-router-dom";

import App from "../App";
import Activity from "../pages/Activity";
import Agents from "../pages/Agents";
import Approvals from "../pages/Approvals";
import Artifacts from "../pages/Artifacts";
import Brain from "../pages/Brain";
import Command from "../pages/Command";
import NotBuilt from "../pages/NotBuilt";
import Tools from "../pages/Tools";
import Work from "../pages/Work";
import WorkDetail from "../pages/WorkDetail";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Command /> },
      { path: "command", element: <Command /> },
      { path: "work", element: <Work /> },
      { path: "work/:workId", element: <WorkDetail /> },
      { path: "agents", element: <Agents /> },
      { path: "tools", element: <Tools /> },
      { path: "brain", element: <Brain /> },
      { path: "artifacts", element: <Artifacts /> },
      { path: "approvals", element: <Approvals /> },
      { path: "activity", element: <Activity /> },
      {
        path: "organization",
        element: (
          <NotBuilt
            title="Organization"
            description="Workspaces, departments and how the workforce is structured."
            planned={[
              "Workspaces, and scoping agents and work to them",
              "Departments grouping agents by responsibility",
              "Creating and configuring agents from the UI rather than a seed script",
              "Organization membership and roles",
            ]}
          />
        ),
      },
      {
        path: "governance",
        element: (
          <NotBuilt
            title="Governance"
            description="Policies, permissions and the audit trail that constrain what agents may do."
            planned={[
              "Policies that decide which actions require approval, instead of the planner deciding per task",
              "Per-agent permission grants beyond tool authorization",
              "A queryable audit trail over the existing event log",
              "Spend and rate limits per agent and per workspace",
            ]}
          />
        ),
      },
    ],
  },
]);
